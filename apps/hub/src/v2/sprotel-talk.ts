import { pickerKey, type PickerState } from './arcade-picker';

/**
 * Sprotel Bitcoin's talk panel in the Bar. Pressing E in his trigger opens it; he answers from a
 * short fixed menu. The Verse store itself (M7 `store.purchase`) is not wired yet, so the store
 * topic says so plainly instead of offering a purchase.
 */
export type TalkTopicId = 'store' | 'verse' | 'cabinet' | 'bye';

export interface TalkTopic {
  id: TalkTopicId;
  /** What the player asks. */
  ask: string;
  /** What Sprotel answers. Empty for `bye`, which closes the panel. */
  answer: string;
}

export const SPROTEL_NAME = 'Sprotel Bitcoin';

export const SPROTEL_GREETINGS: readonly string[] = [
  "Welcome to the Bar. What'll it be?",
  'Pull up a stool. Glass is clean, mostly.',
  "Back again? The cabinet's warm and the taps are cold.",
];

export const SPROTEL_TOPICS: readonly TalkTopic[] = [
  {
    id: 'store',
    ask: 'What are you selling?',
    answer: "The Verse store isn't open yet. When it is, I'll have Hopium Sproto for 400 Verse and Coom Sproto for 600. Save up.",
  },
  {
    id: 'verse',
    ask: 'How do I earn Verse?',
    answer: 'Win in the games and they pay you Tickets. Ten Tickets trade for one Verse, up to 50 Verse a day from each game.',
  },
  {
    id: 'cabinet',
    ask: "What's on the cabinet?",
    answer: 'Sproto Arcade, Sproto Fighter and Sproto Coop Battle. Stand in front of it and press E to pick one.',
  },
  { id: 'bye', ask: 'See you.', answer: '' },
];

export function talkHelp(count: number): string {
  const shown = Math.max(0, Math.min(9, Math.floor(count)));
  const digits = Array.from({ length: shown }, (_, index) => String(index + 1)).join(' / ');
  return shown ? `${digits} or ↑ ↓ · Enter to ask · Esc to leave` : 'Esc to leave';
}

/** Greeting for this visit. `pick` is in [0, 1). */
export function greeting(pick: number): string {
  const index = Math.min(SPROTEL_GREETINGS.length - 1, Math.max(0, Math.floor(pick * SPROTEL_GREETINGS.length)));
  return SPROTEL_GREETINGS[index]!;
}

export interface TalkStep {
  state: PickerState;
  /** Sprotel's new line, or null when the panel should close. Undefined when nothing changed. */
  line?: string | null;
}

/**
 * Keyboard for the talk panel, built on the cabinet picker's keys: 1–9 asks directly, arrows and
 * W/S move, Enter/Space/E asks, Esc/Q leaves. Asking a topic keeps the panel open; `bye` closes it.
 */
export function talkKey(state: PickerState, code: string, topics: readonly TalkTopic[] = SPROTEL_TOPICS): TalkStep {
  const next = pickerKey(state, code, topics.length);
  if (next.action.type === 'close') return { state: next.state, line: null };
  if (next.action.type === 'choose') return ask(next.action.index, topics);
  return { state: next.state };
}

function ask(index: number, topics: readonly TalkTopic[]): TalkStep {
  const topic = topics[index];
  if (!topic || topic.id === 'bye') return { state: { open: false, index: 0 }, line: null };
  return { state: { open: true, index }, line: topic.answer };
}

export interface SprotelTalk {
  readonly open: boolean;
  show(): void;
  hide(): void;
  /** Returns true when the panel consumed the key. */
  handleKey(event: KeyboardEvent): boolean;
}

/** DOM overlay at the bottom of the screen, styled like the cabinet picker. `onClose` runs once per close. */
export function createSprotelTalk(onClose: () => void, parent: HTMLElement = document.body, random: () => number = Math.random): SprotelTalk {
  let state: PickerState = { open: false, index: 0 };
  const root = document.createElement('div');
  root.className = 'sprotel-talk';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `Talk to ${SPROTEL_NAME}`);
  root.style.cssText =
    'position:fixed;left:0;right:0;bottom:84px;display:flex;justify-content:center;z-index:40;pointer-events:none;font:600 15px system-ui,sans-serif;color:#fff4e0';
  const card = document.createElement('div');
  card.style.cssText =
    'pointer-events:auto;box-sizing:border-box;width:min(560px,calc(100vw - 32px));padding:18px 20px;border:2px solid #ffc233;border-radius:10px;background:#140a1cf2;box-shadow:0 0 40px #ffc23355';
  const name = document.createElement('div');
  name.textContent = SPROTEL_NAME.toUpperCase();
  name.style.cssText = 'letter-spacing:.18em;font-size:12px;color:#ffcf6b;margin-bottom:8px';
  const line = document.createElement('p');
  line.setAttribute('aria-live', 'polite');
  line.style.cssText = 'margin:0 0 12px;font-size:16px;line-height:1.4;color:#fff4e0';
  const list = document.createElement('div');
  list.style.cssText = 'display:grid;gap:6px';
  const help = document.createElement('div');
  help.textContent = talkHelp(SPROTEL_TOPICS.length);
  help.style.cssText = 'margin-top:10px;font-size:12px;color:#b9a9c9';
  card.append(name, line, list, help);
  root.append(card);
  parent.append(root);

  function paint(): void {
    list.replaceChildren();
    SPROTEL_TOPICS.forEach((topic, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      const selected = index === state.index;
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = `${index + 1}  ${topic.ask}`;
      button.style.cssText = `text-align:left;padding:7px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:14px;color:inherit;background:${
        selected ? '#2a1636' : '#1b1024'
      };border:2px solid ${selected ? '#ffc233' : '#3b2a48'}`;
      button.addEventListener('click', () => apply(ask(index, SPROTEL_TOPICS)));
      list.append(button);
    });
  }

  function apply(step: TalkStep): void {
    if (step.line === null) {
      hide();
      return;
    }
    state = step.state;
    if (step.line !== undefined) line.textContent = step.line;
    paint();
  }

  function hide(): void {
    if (!state.open) return;
    state = { open: false, index: 0 };
    root.hidden = true;
    onClose();
  }

  return {
    get open() {
      return state.open;
    },
    show() {
      if (state.open) return;
      state = { open: true, index: 0 };
      line.textContent = greeting(random());
      paint();
      root.hidden = false;
    },
    hide,
    handleKey(event) {
      if (!state.open) return false;
      // Browser shortcuts (reload, dev tools, F-keys) pass through untouched.
      if (event.ctrlKey || event.metaKey || event.altKey || /^F\d{1,2}$/.test(event.code)) return false;
      if (event.repeat) return true;
      event.preventDefault();
      apply(talkKey(state, event.code));
      return true;
    },
  };
}
