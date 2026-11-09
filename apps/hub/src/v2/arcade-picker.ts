import type { GameId } from '@metaverse/hub-sdk';

/** One game on the Bar's arcade cabinet. */
export interface ArcadeChoice {
  id: GameId;
  label: string;
  place: string;
  color: string;
  blurb: string;
}

export interface PickerState {
  open: boolean;
  index: number;
}

export type PickerAction =
  | { type: 'none' }
  | { type: 'close' }
  | { type: 'choose'; index: number };

export const PICKER_CLOSED: PickerState = { open: false, index: 0 };

/**
 * Help line for the games currently shown. Count follows the visible list, up to the 1–9 keys.
 * `pad`: a controller was the last device used, so the line names its buttons instead.
 */
export function pickerHelp(count: number, pad = false): string {
  const shown = Math.max(0, Math.min(9, Math.floor(count)));
  if (pad) return shown > 0 ? '↑ ↓ choose · A to play · B to step away' : 'B to step away';
  if (shown <= 0) return 'Esc to step away';
  const digits = Array.from({ length: shown }, (_, index) => String(index + 1)).join(' / ');
  return `${digits} or ↑ ↓ · Enter to play · Esc to step away`;
}

/**
 * Keyboard for the cabinet picker. 1–9 picks directly; arrows, W/S/A/D move; Enter, Space or E
 * confirms; Escape or Q closes. Pure, so the hub's keydown handler and the tests share it.
 */
export function pickerKey(state: PickerState, code: string, count: number): { state: PickerState; action: PickerAction } {
  if (!state.open || count <= 0) return { state, action: { type: 'none' } };
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (digit) {
    const index = Number(digit[1]) - 1;
    if (index < count) return { state: { open: false, index }, action: { type: 'choose', index } };
    return { state, action: { type: 'none' } };
  }
  switch (code) {
    case 'ArrowUp':
    case 'ArrowLeft':
    case 'KeyW':
    case 'KeyA':
      return { state: { open: true, index: (state.index + count - 1) % count }, action: { type: 'none' } };
    case 'ArrowDown':
    case 'ArrowRight':
    case 'KeyS':
    case 'KeyD':
      return { state: { open: true, index: (state.index + 1) % count }, action: { type: 'none' } };
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
    case 'KeyE':
      return { state: { open: false, index: state.index }, action: { type: 'choose', index: state.index } };
    case 'Escape':
    case 'KeyQ':
      return { state: { open: false, index: state.index }, action: { type: 'close' } };
    default:
      return { state, action: { type: 'none' } };
  }
}

export interface ArcadePicker {
  readonly open: boolean;
  /** Opens on the last game chosen. `available` hides choices with no page. */
  show(available: (id: GameId) => boolean): void;
  hide(): void;
  /** Returns true when the picker consumed the key. */
  handleKey(event: KeyboardEvent): boolean;
  /** Show controller prompts (true) or keyboard prompts (false). */
  setPad(on: boolean): void;
}

/** A two-line DOM overlay. `onChoose` receives the picked game. */
export function createArcadePicker(
  choices: readonly ArcadeChoice[],
  onChoose: (choice: ArcadeChoice) => void,
  parent: HTMLElement = document.body,
): ArcadePicker {
  let state: PickerState = PICKER_CLOSED;
  let shown: ArcadeChoice[] = [];
  let pad = false;
  const root = document.createElement('div');
  root.className = 'arcade-picker';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Choose an arcade game');
  root.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;z-index:40;background:#05030acc;font:600 15px system-ui,sans-serif;color:#fff4e0';
  const card = document.createElement('div');
  card.style.cssText =
    'box-sizing:border-box;width:min(560px,calc(100vw - 32px));padding:20px;border:2px solid #ff3d6e;border-radius:10px;background:#140a1c;box-shadow:0 0 40px #ff3d6e66';
  const title = document.createElement('div');
  title.textContent = 'ARCADE · CHOOSE A GAME';
  title.style.cssText = 'letter-spacing:.18em;font-size:12px;color:#ffcf6b;margin-bottom:12px';
  const list = document.createElement('div');
  list.style.cssText = 'display:grid;gap:8px';
  const help = document.createElement('div');
  help.textContent = pickerHelp(0);
  help.style.cssText = 'margin-top:12px;font-size:12px;color:#b9a9c9';
  card.append(title, list, help);
  root.append(card);
  parent.append(root);

  function paint(): void {
    list.replaceChildren();
    shown.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      const selected = index === state.index;
      button.setAttribute('aria-pressed', String(selected));
      button.style.cssText = `display:grid;gap:2px;text-align:left;padding:10px 12px;border-radius:6px;cursor:pointer;font:inherit;color:inherit;background:${
        selected ? '#2a1636' : '#1b1024'
      };border:2px solid ${selected ? choice.color : '#3b2a48'}`;
      const name = document.createElement('span');
      name.textContent = `${index + 1}  ${choice.label}`;
      name.style.color = choice.color;
      const blurb = document.createElement('span');
      blurb.textContent = choice.blurb;
      blurb.style.cssText = 'font-size:12px;font-weight:500;color:#d8c9e6';
      button.append(name, blurb);
      button.addEventListener('click', () => choose(index));
      list.append(button);
    });
    help.textContent = pickerHelp(shown.length, pad);
  }

  function choose(index: number): void {
    const choice = shown[index];
    hide();
    if (choice) onChoose(choice);
  }

  function hide(): void {
    state = { open: false, index: state.index };
    root.hidden = true;
  }

  return {
    get open() {
      return state.open;
    },
    show(available) {
      shown = choices.filter((choice) => available(choice.id));
      if (!shown.length) return;
      state = { open: true, index: Math.min(state.index, shown.length - 1) };
      paint();
      root.hidden = false;
    },
    hide,
    setPad(on) {
      if (on === pad) return;
      pad = on;
      help.textContent = pickerHelp(shown.length, pad);
    },
    handleKey(event) {
      if (!state.open) return false;
      // Browser shortcuts (reload, dev tools, F-keys) pass through untouched.
      if (event.ctrlKey || event.metaKey || event.altKey || /^F\d{1,2}$/.test(event.code)) return false;
      if (event.repeat) return true;
      const next = pickerKey(state, event.code, shown.length);
      event.preventDefault();
      if (next.action.type === 'choose') {
        state = next.state;
        choose(next.action.index);
      } else if (next.action.type === 'close') {
        hide();
      } else {
        state = next.state;
        paint();
      }
      return true;
    },
  };
}
