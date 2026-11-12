import { EXPLAINER, ONBOARDING_STEPS, type OnboardingView } from './onboarding';
import { markerOpacity, markerText, placeMarker, spreadMarkers, type MarkerMargins, type Waypoint } from './markers';

/**
 * HUD pieces for onboarding and discovery (plan items D1, D2, D4, D5): the first-visit card with
 * its "?" button, the gate markers, the return card and the small confirm dialog. Plain DOM over
 * the canvas; every rule lives in the pure modules beside this file.
 */
export interface HudGuide {
  /** Paint the first-visit card from the reducer's view. */
  paintOnboarding(view: OnboardingView): void;
  /** The "?" explainer is open. */
  readonly helpOpen: boolean;
  toggleHelp(open?: boolean): void;
  /** Show the return card for a while. */
  showTrip(title: string, lines: readonly string[], accent: string): void;
  /** True while a card that B / Esc should close is up (first-visit card, help, return card). */
  readonly dismissable: boolean;
  /** Close the top dismissable card. Returns what was closed. */
  dismiss(): 'help' | 'trip' | 'onboarding' | null;
  /** Ask a yes / no question. Resolves false on cancel. Only one at a time. */
  confirm(question: string, detail: string, yes: string, no: string): Promise<boolean>;
  /** A confirm dialog is up: it owns the keyboard and the pad. */
  readonly confirmOpen: boolean;
  /** Answer the open confirm (keyboard Enter / Esc, pad A / B). */
  answer(yes: boolean): void;
  /** Place the gate markers for this frame. `toCamera` maps a waypoint into camera space. */
  updateMarkers(
    waypoints: readonly Waypoint[],
    player: { x: number; z: number },
    toCamera: (point: Waypoint) => { x: number; y: number; z: number },
    fovYRadians: number,
    viewport: { width: number; height: number },
    visible: boolean,
  ): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const TRIP_MS = 12_000;

export function createHudGuide(hud: HTMLElement, onDismissOnboarding: () => void): HudGuide {
  // ---------- First-visit card
  const card = el('section', 'guide-card');
  card.hidden = true;
  card.setAttribute('aria-label', 'Getting started');
  const cardTitle = el('h2', 'guide-title', 'Welcome to the plaza');
  const cardLede = el('p', 'guide-lede', 'Eight games live here. Each one gives a Relic.');
  const steps = el('ol', 'guide-steps');
  const stepNodes = ONBOARDING_STEPS.map((step, index) => {
    const item = el('li', 'guide-step');
    const box = el('span', 'guide-tick', String(index + 1));
    const text = el('span', 'guide-step-text');
    text.append(el('strong', '', step.title), el('span', '', step.note));
    item.append(box, text);
    steps.append(item);
    return { item, box, number: String(index + 1) };
  });
  const cardClose = el('button', 'guide-close', 'Got it');
  cardClose.type = 'button';
  cardClose.addEventListener('click', () => onDismissOnboarding());
  card.append(cardTitle, cardLede, steps, cardClose);

  // ---------- "?" explainer
  const helpButton = el('button', 'hud-btn guide-help-btn', '?');
  helpButton.type = 'button';
  helpButton.setAttribute('aria-label', 'How Tickets, Verse and Relics work');
  helpButton.setAttribute('aria-expanded', 'false');
  const help = el('section', 'guide-card guide-help');
  help.hidden = true;
  help.setAttribute('aria-label', 'Tickets, Verse and Relics');
  help.append(el('h2', 'guide-title', 'How it works'));
  const terms = el('dl', 'guide-terms');
  for (const entry of EXPLAINER) terms.append(el('dt', '', entry.term), el('dd', '', entry.text));
  const helpSteps = el('p', 'guide-lede', ONBOARDING_STEPS.map((step, index) => `${index + 1}. ${step.title}`).join('  ·  '));
  const helpClose = el('button', 'guide-close', 'Close');
  helpClose.type = 'button';
  help.append(terms, helpSteps, helpClose);
  let helpOpen = false;
  let onboardingShown = false;
  const toggleHelp = (open = !helpOpen): void => {
    helpOpen = open;
    help.hidden = !open;
    // Both cards use the same corner: the explainer covers the first-visit card while it is open.
    card.hidden = !onboardingShown || open;
    helpButton.setAttribute('aria-expanded', String(open));
  };
  helpButton.addEventListener('click', () => toggleHelp());
  helpClose.addEventListener('click', () => toggleHelp(false));

  // ---------- Return card
  const trip = el('section', 'guide-card guide-trip');
  trip.hidden = true;
  trip.setAttribute('role', 'status');
  const tripTitle = el('h2', 'guide-title');
  const tripList = el('ul', 'guide-lines');
  const tripClose = el('button', 'guide-close', 'OK');
  tripClose.type = 'button';
  trip.append(tripTitle, tripList, tripClose);
  let tripTimer: number | null = null;
  const hideTrip = (): void => {
    trip.hidden = true;
    if (tripTimer !== null) window.clearTimeout(tripTimer);
    tripTimer = null;
  };
  tripClose.addEventListener('click', hideTrip);

  // ---------- Confirm
  const confirmRoot = el('div', 'guide-confirm');
  confirmRoot.hidden = true;
  const confirmBox = el('section', 'guide-card guide-confirm-box');
  confirmBox.setAttribute('role', 'alertdialog');
  confirmBox.setAttribute('aria-modal', 'true');
  const confirmTitle = el('h2', 'guide-title');
  const confirmDetail = el('p', 'guide-lede');
  const confirmRow = el('div', 'guide-row');
  const confirmYes = el('button', 'guide-close guide-yes');
  const confirmNo = el('button', 'guide-close guide-no');
  confirmYes.type = 'button';
  confirmNo.type = 'button';
  confirmRow.append(confirmYes, confirmNo);
  confirmBox.append(confirmTitle, confirmDetail, confirmRow);
  confirmRoot.append(confirmBox);
  let settle: ((yes: boolean) => void) | null = null;
  const answer = (yes: boolean): void => {
    const done = settle;
    settle = null;
    confirmRoot.hidden = true;
    done?.(yes);
  };
  confirmYes.addEventListener('click', () => answer(true));
  confirmNo.addEventListener('click', () => answer(false));

  // ---------- Markers
  const layer = el('div', 'gate-markers');
  layer.setAttribute('aria-hidden', 'true');
  const markerNodes = new Map<string, { node: HTMLDivElement; text: string; width: number; height: number }>();
  const margins: MarkerMargins = { top: 76, bottom: 96, side: 84 };

  // The "?" sits in the top-right button row, before the Relic count.
  const actions = hud.querySelector('.hud-actions');
  if (actions) actions.prepend(helpButton);
  else hud.append(helpButton);
  hud.append(layer, card, help, trip, confirmRoot);

  return {
    paintOnboarding(view) {
      onboardingShown = view.show;
      card.hidden = !view.show || helpOpen;
      if (!view.show) return;
      stepNodes.forEach((step, index) => {
        const done = view.ticks[index] === true;
        step.item.classList.toggle('done', done);
        step.item.classList.toggle('current', view.current === index);
        step.box.textContent = done ? '✓' : step.number;
      });
    },
    get helpOpen() { return helpOpen; },
    toggleHelp,
    showTrip(title, lines, accent) {
      tripTitle.textContent = title;
      trip.style.setProperty('--accent', accent);
      tripList.replaceChildren(...lines.map((line) => el('li', '', line)));
      trip.hidden = false;
      if (tripTimer !== null) window.clearTimeout(tripTimer);
      tripTimer = window.setTimeout(hideTrip, TRIP_MS);
    },
    get dismissable() { return helpOpen || !trip.hidden || onboardingShown; },
    dismiss() {
      if (helpOpen) {
        toggleHelp(false);
        return 'help';
      }
      if (!trip.hidden) {
        hideTrip();
        return 'trip';
      }
      if (onboardingShown) {
        onDismissOnboarding();
        return 'onboarding';
      }
      return null;
    },
    confirm(question, detail, yes, no) {
      if (settle) return Promise.resolve(false);
      confirmTitle.textContent = question;
      confirmDetail.textContent = detail;
      confirmYes.textContent = yes;
      confirmNo.textContent = no;
      confirmRoot.hidden = false;
      confirmYes.focus({ preventScroll: true });
      return new Promise<boolean>((resolve) => {
        settle = resolve;
      });
    },
    get confirmOpen() { return settle !== null; },
    answer,
    updateMarkers(waypoints, player, toCamera, fovYRadians, viewport, visible) {
      layer.hidden = !visible;
      if (!visible) return;
      const seen = new Set<string>();
      const corner = !help.hidden ? help : !card.hidden ? card : null;
      const cornerInset = corner ? corner.offsetWidth + 16 : 0;
      const rows = waypoints.map((point) => {
        seen.add(point.id);
        const distance = Math.hypot(point.x - player.x, point.z - player.z);
        const text = markerText(point.label, distance);
        let entry = markerNodes.get(point.id);
        if (!entry) {
          const node = el('div', 'gate-marker');
          node.dataset.marker = point.id;
          layer.append(node);
          entry = { node, text: '', width: 0, height: 0 };
          markerNodes.set(point.id, entry);
        }
        if (entry.text !== text) {
          entry.node.textContent = text;
          entry.text = text;
          // Measure only when the text changes: reading layout every frame would be wasteful.
          entry.width = entry.node.offsetWidth;
          entry.height = entry.node.offsetHeight;
        }
        const place = placeMarker(toCamera(point), fovYRadians, viewport, {
          ...margins,
          side: Math.max(margins.side, entry.width / 2 + 12),
          // Keep labels clear of whichever card is up in the top-right corner.
          rightInset: cornerInset,
        });
        return { entry, place, distance, opacity: markerOpacity(distance) };
      });
      const ys = spreadMarkers(
        rows.map((row) => ({ x: row.place.x, y: row.place.y, width: row.entry.width, height: row.entry.height, distance: row.distance })),
        { top: margins.top, bottom: viewport.height - margins.bottom },
      );
      rows.forEach((row, index) => {
        const { node } = row.entry;
        node.style.opacity = row.opacity.toFixed(2);
        node.classList.toggle('edge', row.place.edge);
        node.style.transform = `translate(${row.place.x.toFixed(1)}px, ${(ys[index] ?? row.place.y).toFixed(1)}px) translate(-50%, -50%)`;
      });
      for (const [id, entry] of markerNodes) {
        if (seen.has(id)) continue;
        entry.node.remove();
        markerNodes.delete(id);
      }
    },
  };
}
