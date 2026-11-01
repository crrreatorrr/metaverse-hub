/**
 * Public chat, RuneScape style: Enter opens the box, Enter sends, and the
 * line floats over the wizard's head for a few seconds. Prefixes such as
 * `red:wave:hello` colour and animate the overhead text.
 *
 * There is no realtime channel yet, so a line is only seen by its sender.
 */

export const CHAT_MAX_LENGTH = 80;
const LOG_LINES = 40;
const IDLE_MS = 12_000;

export const CHAT_COLORS = ['yellow', 'red', 'green', 'cyan', 'purple', 'white', 'flash1', 'flash2', 'flash3', 'glow1', 'glow2', 'glow3'] as const;
export const CHAT_EFFECTS = ['wave', 'wave2', 'shake', 'scroll', 'slide'] as const;
export type ChatColor = (typeof CHAT_COLORS)[number];
export type ChatEffect = (typeof CHAT_EFFECTS)[number];

export interface ParsedChat {
  color: ChatColor;
  effect: ChatEffect | null;
  text: string;
}

/** Up to one colour and one effect, in either order, before the text. Unknown prefixes stay in the text. */
export function parseChat(input: string): ParsedChat {
  let rest = input.trim();
  let color: ChatColor = 'yellow';
  let effect: ChatEffect | null = null;
  let colorSet = false;
  for (let i = 0; i < 2; i += 1) {
    const match = /^([a-z0-9]+):/i.exec(rest);
    if (!match) break;
    const word = match[1].toLowerCase();
    if (!colorSet && (CHAT_COLORS as readonly string[]).includes(word)) {
      color = word as ChatColor;
      colorSet = true;
    } else if (!effect && (CHAT_EFFECTS as readonly string[]).includes(word)) {
      effect = word as ChatEffect;
    } else {
      break;
    }
    rest = rest.slice(match[0].length).trimStart();
  }
  return { color, effect, text: rest.slice(0, CHAT_MAX_LENGTH) };
}

export interface ChatOptions {
  /** Name in front of chat log lines. */
  name: () => string;
  /** Box opened. The caller frees the mouse and stops movement. */
  onOpen: () => void;
  /** Box closed. `sent` is true when a line went out. */
  onClose: (sent: boolean) => void;
}

export interface Chat {
  readonly open: boolean;
  show(): void;
  hide(): void;
  /** System line in the log only. */
  system(text: string): void;
  /**
   * Places the overhead text. `x`/`y` are CSS pixels; `scale` shrinks it with
   * distance. Pass null when the head is off screen.
   */
  place(point: { x: number; y: number; scale: number } | null): void;
  /** Ticks the overhead timer. */
  update(dt: number): void;
}

export function createChat(options: ChatOptions): Chat {
  const hud = document.querySelector('#hud');
  if (!(hud instanceof HTMLElement)) throw new Error('Hub HUD is missing');

  const box = document.createElement('section');
  box.id = 'chat';
  box.className = 'chat';
  box.setAttribute('aria-label', 'Chat');
  const log = document.createElement('ol');
  log.className = 'chat-log';
  log.setAttribute('aria-live', 'polite');
  const row = document.createElement('label');
  row.className = 'chat-row';
  const who = document.createElement('span');
  who.className = 'chat-who';
  const field = document.createElement('input');
  field.className = 'chat-field';
  field.type = 'text';
  field.maxLength = CHAT_MAX_LENGTH + 24;
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.placeholder = 'Say something…  try red:wave:hello';
  field.setAttribute('aria-label', 'Chat message');
  const prompt = document.createElement('span');
  prompt.className = 'chat-prompt';
  prompt.textContent = 'Press Enter to chat';
  row.append(who, field);
  box.append(log, row, prompt);
  hud.append(box);

  const overhead = document.createElement('div');
  overhead.className = 'overhead';
  overhead.hidden = true;
  overhead.setAttribute('aria-hidden', 'true');
  hud.append(overhead);

  let open = false;
  let left = 0;
  let idleTimer = 0;
  markActive();

  field.addEventListener('keydown', (event) => {
    // The window handler skips typing targets; keep keys out of the plaza.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      const sent = send(field.value);
      close(sent);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(false);
    }
  });
  field.addEventListener('blur', () => {
    if (open) close(false);
  });

  function markActive(): void {
    box.classList.remove('idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (!open) box.classList.add('idle');
    }, IDLE_MS);
  }

  function show(): void {
    if (open) return;
    open = true;
    who.textContent = `${options.name()}:`;
    box.classList.add('open');
    markActive();
    options.onOpen();
    field.value = '';
    field.focus({ preventScroll: true });
  }

  function close(sent: boolean): void {
    if (!open) return;
    open = false;
    box.classList.remove('open');
    field.value = '';
    if (document.activeElement === field) field.blur();
    markActive();
    options.onClose(sent);
  }

  function send(raw: string): boolean {
    const parsed = parseChat(raw.replace(/\s+/g, ' '));
    if (!parsed.text) return false;
    addLine(options.name(), parsed.text, 'public');
    float(parsed);
    return true;
  }

  function addLine(name: string | null, text: string, kind: 'public' | 'system'): void {
    const item = document.createElement('li');
    item.className = `chat-line ${kind}`;
    if (name) {
      const tag = document.createElement('span');
      tag.className = 'chat-name';
      tag.textContent = `${name}: `;
      item.append(tag);
    }
    const body = document.createElement('span');
    body.className = 'chat-text';
    body.textContent = text;
    item.append(body);
    log.append(item);
    while (log.children.length > LOG_LINES) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
    markActive();
  }

  function float(parsed: ParsedChat): void {
    overhead.replaceChildren();
    overhead.className = `overhead c-${parsed.color}${parsed.effect ? ` fx-${parsed.effect}` : ''}`;
    const line = document.createElement('span');
    line.className = 'overhead-line';
    if (parsed.effect === 'wave' || parsed.effect === 'wave2' || parsed.effect === 'shake') {
      [...parsed.text].forEach((char, index) => {
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.style.setProperty('--i', String(index));
        glyph.textContent = char === ' ' ? ' ' : char;
        line.append(glyph);
      });
    } else {
      line.textContent = parsed.text;
    }
    overhead.append(line);
    overhead.hidden = false;
    // RuneScape holds overhead text about five seconds; long lines get a little more.
    left = 4.5 + parsed.text.length * 0.04;
    overhead.style.opacity = '1';
  }

  return {
    get open() { return open; },
    show,
    hide: () => close(false),
    system(text: string) {
      addLine(null, text, 'system');
    },
    place(point) {
      if (overhead.hidden) return;
      if (!point) {
        overhead.style.visibility = 'hidden';
        return;
      }
      overhead.style.visibility = 'visible';
      overhead.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -100%) scale(${point.scale.toFixed(3)})`;
    },
    update(dt) {
      if (overhead.hidden) return;
      left -= dt;
      if (left <= 0) {
        overhead.hidden = true;
        overhead.replaceChildren();
        return;
      }
      if (left < 0.4) overhead.style.opacity = String(left / 0.4);
    },
  };
}
