/**
 * Controller input for the plaza. Pure: it reads plain gamepad snapshots, so the tests feed it
 * fake pads and the shell feeds it `navigator.getGamepads()` once per frame.
 *
 * It follows the shared Sproto controller convention in docs/controllers.md: W3C standard
 * mapping, polled every frame, buttons already held when a pad appears are ignored until they
 * are released (so the A press that confirmed a game's exit does not also fire in the plaza),
 * radial deadzones, and D-pad / left stick menu navigation with key-repeat style auto-repeat.
 */

/** W3C "standard" mapping button indices, by Xbox name. */
export const PAD = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
});
export type PadButton = (typeof PAD)[keyof typeof PAD];

/** Every controller number in one place. Rates are radians per second at full deflection. */
export const PAD_TUNING = Object.freeze({
  moveDeadzone: 0.2,
  lookDeadzone: 0.15,
  /** Analog triggers count as pressed past this. */
  triggerThreshold: 0.5,
  /** Left stick past this on one axis is a menu step. */
  navThreshold: 0.5,
  repeatDelayMs: 350,
  repeatRateMs: 120,
  lookYawRate: 2.6,
  lookPitchRate: 1.5,
  /** Response curve exponent for the camera stick: small tilts aim finely, full tilt turns fast. */
  lookCurve: 1.6,
  /** Avatar preview spin in the menu, radians per second. */
  previewSpinRate: 3,
});
export type PadTuning = typeof PAD_TUNING;

/** The parts of a `Gamepad` the reader uses, so tests can pass plain objects. */
export interface PadSnapshot {
  readonly index: number;
  readonly connected?: boolean;
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

export type NavDir = 'up' | 'down' | 'left' | 'right';

export interface Stick { x: number; y: number }

/** Which stick walks. The other one turns the camera. */
export type MoveStick = 'left' | 'right';

/** Standard layout: left stick walks and right stick looks. */
export const DEFAULT_MOVE_STICK: MoveStick = 'left';
const MOVE_STICK_KEY = 'hub:pad-move-stick';

/** The stored stick layout (menu → Items → Controller), or the default. Safe without storage. */
export function loadMoveStick(): MoveStick {
  try {
    const stored = globalThis.localStorage?.getItem(MOVE_STICK_KEY);
    return stored === 'left' || stored === 'right' ? stored : DEFAULT_MOVE_STICK;
  } catch {
    return DEFAULT_MOVE_STICK;
  }
}

export function saveMoveStick(stick: MoveStick): void {
  try {
    globalThis.localStorage?.setItem(MOVE_STICK_KEY, stick);
  } catch {
    // Storage may be off (private window). The layout still applies for this visit.
  }
}

/** Axis indices (x, y) of the walking and camera sticks for a layout. */
export function stickAxes(moveStick: MoveStick): { move: readonly [number, number]; look: readonly [number, number] } {
  return moveStick === 'left' ? { move: [0, 1], look: [2, 3] } : { move: [2, 3], look: [0, 1] };
}

/** The stick-click button of the walking stick and of the camera stick for a layout. */
export function stickClicks(moveStick: MoveStick): { move: PadButton; look: PadButton } {
  return moveStick === 'left' ? { move: PAD.LS, look: PAD.RS } : { move: PAD.RS, look: PAD.LS };
}

export interface PadFrame {
  /** A pad is connected and has been used (or is the only one). */
  readonly connected: boolean;
  /** Any button press or stick motion this frame, for "last device used" prompts. */
  readonly active: boolean;
  /** Walking stick (left or right, see `MoveStick`) and D-pad, deadzoned and rescaled. y is down-positive like the raw axis. */
  readonly move: Stick;
  /** Camera stick, deadzoned and curved. */
  readonly look: Stick;
  held(button: PadButton): boolean;
  /** Went down this frame (and was not latched). */
  pressed(button: PadButton): boolean;
  /** A menu step this frame: D-pad or the walking stick, first press then auto-repeat. */
  readonly nav: NavDir | null;
}

const NO_STICK: Stick = Object.freeze({ x: 0, y: 0 });
const BUTTON_COUNT = 16;

/**
 * Radial deadzone with rescale: inside `deadzone` reads 0, and the output ramps from 0 at the
 * edge to 1 at full tilt, so motion starts smoothly instead of jumping to 20 %.
 */
export function radialDeadzone(x: number, y: number, deadzone: number): Stick {
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  const mag = Math.hypot(fx, fy);
  if (mag <= deadzone || mag === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return { x: (fx / mag) * scaled, y: (fy / mag) * scaled };
}

/** Keeps direction, raises magnitude to `exponent`. */
export function curve(stick: Stick, exponent: number): Stick {
  const mag = Math.hypot(stick.x, stick.y);
  if (mag === 0) return { x: 0, y: 0 };
  const out = Math.pow(mag, exponent);
  return { x: (stick.x / mag) * out, y: (stick.y / mag) * out };
}

function buttonDown(pad: PadSnapshot, index: number, threshold: number): boolean {
  const button = pad.buttons[index];
  if (!button) return false;
  // Triggers report pressed at the slightest touch on some pads; use the value for them.
  if (index === PAD.LT || index === PAD.RT) return button.value > threshold || (button.pressed && !(button.value > 0));
  return Boolean(button.pressed) || button.value > threshold;
}

/** Which of the four directions the D-pad or a stick (axes `axisX`, `axisX + 1`) points at, or null. */
export function navDirection(pad: PadSnapshot, tuning: PadTuning = PAD_TUNING, axisX = 0): NavDir | null {
  if (buttonDown(pad, PAD.UP, tuning.triggerThreshold)) return 'up';
  if (buttonDown(pad, PAD.DOWN, tuning.triggerThreshold)) return 'down';
  if (buttonDown(pad, PAD.LEFT, tuning.triggerThreshold)) return 'left';
  if (buttonDown(pad, PAD.RIGHT, tuning.triggerThreshold)) return 'right';
  const x = pad.axes[axisX] ?? 0;
  const y = pad.axes[axisX + 1] ?? 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < tuning.navThreshold) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

export interface PadReader {
  /** Call once per frame with `navigator.getGamepads()` and a millisecond clock. */
  poll(pads: readonly (PadSnapshot | null | undefined)[] | null | undefined, now: number): PadFrame;
  /** Index of the pad being read, or null. */
  readonly activeIndex: number | null;
  /**
   * Ignores every button held right now until it is released (rule 2, for a screen that closes
   * under the press: the A that confirmed the login gate must not also use the cabinet).
   */
  latch(): void;
}

export interface PadReaderOptions {
  /** Read every poll, so a menu change applies at once. Defaults to the left stick (docs/controllers.md). */
  moveStick?: () => MoveStick;
}

export function createPadReader(tuning: PadTuning = PAD_TUNING, options: PadReaderOptions = {}): PadReader {
  const moveStickOf = options.moveStick ?? (() => 'left' as const);
  /** Pads seen last poll, by index, with the buttons they still have latched. */
  const known = new Map<number, Set<number>>();
  /** Raw held buttons from the last poll, by pad index, for `latch()`. */
  const lastHeld = new Map<number, readonly boolean[]>();
  let activeIndex: number | null = null;
  let previous: boolean[] = new Array<boolean>(BUTTON_COUNT).fill(false);
  let navDir: NavDir | null = null;
  let navNext = 0;

  function idle(): PadFrame {
    previous = new Array<boolean>(BUTTON_COUNT).fill(false);
    navDir = null;
    return {
      connected: false,
      active: false,
      move: NO_STICK,
      look: NO_STICK,
      held: () => false,
      pressed: () => false,
      nav: null,
    };
  }

  function rawHeld(pad: PadSnapshot): boolean[] {
    const out: boolean[] = [];
    for (let index = 0; index < BUTTON_COUNT; index += 1) out.push(buttonDown(pad, index, tuning.triggerThreshold));
    return out;
  }

  function used(pad: PadSnapshot, held: readonly boolean[], latched: ReadonlySet<number>): boolean {
    if (held.some((down, index) => down && !latched.has(index))) return true;
    const left = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, tuning.moveDeadzone);
    const right = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, tuning.lookDeadzone);
    return left.x !== 0 || left.y !== 0 || right.x !== 0 || right.y !== 0;
  }

  return {
    get activeIndex() {
      return activeIndex;
    },
    latch() {
      for (const [index, held] of lastHeld) {
        const latched = known.get(index);
        if (latched) held.forEach((down, button) => { if (down) latched.add(button); });
      }
      previous = new Array<boolean>(BUTTON_COUNT).fill(false);
      navDir = null;
    },
    poll(list, now) {
      const pads = (list ? Array.from(list) : []).filter(
        (pad): pad is PadSnapshot => Boolean(pad) && pad?.connected !== false,
      );
      const present = new Set(pads.map((pad) => pad.index));
      for (const index of [...known.keys()]) if (!present.has(index)) known.delete(index);
      lastHeld.clear();
      if (activeIndex !== null && !present.has(activeIndex)) activeIndex = null;

      // Latch on connect, then release latches as buttons come up. Track which pad is in use.
      const heldByPad = new Map<number, boolean[]>();
      for (const pad of pads) {
        const held = rawHeld(pad);
        heldByPad.set(pad.index, held);
        lastHeld.set(pad.index, held);
        let latched = known.get(pad.index);
        if (!latched) {
          latched = new Set(held.flatMap((down, index) => (down ? [index] : [])));
          known.set(pad.index, latched);
        } else {
          for (const index of [...latched]) if (!held[index]) latched.delete(index);
        }
        if (pad.index !== activeIndex && used(pad, held, latched)) {
          activeIndex = pad.index;
          // The press that picked this pad counts as a press.
          previous = new Array<boolean>(BUTTON_COUNT).fill(false);
          navDir = null;
        }
      }
      if (activeIndex === null && pads.length) activeIndex = pads[0].index;
      const pad = pads.find((entry) => entry.index === activeIndex);
      if (!pad) return idle();

      const latched = known.get(pad.index) ?? new Set<number>();
      const raw = heldByPad.get(pad.index) ?? rawHeld(pad);
      const held = raw.map((down, index) => down && !latched.has(index));
      const edges = held.map((down, index) => down && !previous[index]);
      previous = held;

      const axes = stickAxes(moveStickOf());
      const stick = radialDeadzone(pad.axes[axes.move[0]] ?? 0, pad.axes[axes.move[1]] ?? 0, tuning.moveDeadzone);
      const dx = (held[PAD.RIGHT] ? 1 : 0) - (held[PAD.LEFT] ? 1 : 0);
      const dy = (held[PAD.DOWN] ? 1 : 0) - (held[PAD.UP] ? 1 : 0);
      const move = dx || dy ? { x: dx, y: dy } : stick;
      const look = curve(
        radialDeadzone(pad.axes[axes.look[0]] ?? 0, pad.axes[axes.look[1]] ?? 0, tuning.lookDeadzone),
        tuning.lookCurve,
      );

      // Menu steps: latched D-pad buttons do not count, the walking stick does (it has no "press").
      // Copy fields by name: a real Gamepad keeps index and axes as prototype getters, so a spread drops them.
      const latchedPad: PadSnapshot = {
        index: pad.index,
        axes: pad.axes,
        buttons: pad.buttons.map((button, index) => (latched.has(index) ? { pressed: false, value: 0 } : button)),
      };
      const dir = navDirection(latchedPad, tuning, axes.move[0]);
      let nav: NavDir | null = null;
      if (dir !== navDir) {
        navDir = dir;
        if (dir) {
          nav = dir;
          navNext = now + tuning.repeatDelayMs;
        }
      } else if (dir && now >= navNext) {
        nav = dir;
        navNext = now + tuning.repeatRateMs;
      }

      return {
        connected: true,
        active: edges.some(Boolean) || move.x !== 0 || move.y !== 0 || look.x !== 0 || look.y !== 0,
        move,
        look,
        held: (button) => Boolean(held[button]),
        pressed: (button) => Boolean(edges[button]),
        nav,
      };
    },
  };
}

/** Keyboard prompts in realm text, rewritten for a controller (A uses, View opens chat). */
export function padPrompt(text: string): string {
  return text.replace(/\bPress E\b/g, 'Press A').replace(/\bPress Enter to chat\b/g, 'Press View to chat');
}

/** The pad's rumble motor, where the browser has one. */
interface Rumbler {
  vibrationActuator?: {
    playEffect?(type: string, params: Record<string, number>): Promise<unknown>;
  } | null;
}

/** A short tap of rumble on the pad in use, to confirm a choice. Silent where unsupported. */
export function rumble(pads: readonly unknown[] | null | undefined, index: number | null, strength = 0.5, ms = 90): void {
  if (index === null || !pads) return;
  const pad = Array.from(pads).find((entry) => (entry as { index?: number } | null)?.index === index) as Rumbler | undefined;
  try {
    void pad?.vibrationActuator?.playEffect?.('dual-rumble', {
      startDelay: 0,
      duration: ms,
      weakMagnitude: strength,
      strongMagnitude: strength * 0.6,
    })?.catch(() => undefined);
  } catch {
    // Some browsers throw for pads without a motor.
  }
}
