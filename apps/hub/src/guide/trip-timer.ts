/**
 * Countdown for a card that hides itself (the return card). It only runs while the plaza is on
 * screen: a card raised behind the login gate or the loading bar waits, so a slow load does not
 * use up its time before anyone can read it.
 */
export interface CardTimer {
  /** The card was shown or refreshed: (re)start the countdown, or hold it until the plaza is visible. */
  show(): void;
  /** The plaza is on screen. Starts a held countdown; later calls do nothing. */
  visible(): void;
  /** The card was closed by hand. */
  cancel(): void;
}

export interface TimerHost {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export function createCardTimer(ms: number, onExpire: () => void, host: TimerHost): CardTimer {
  let handle: unknown = null;
  let waiting = false;
  let onScreen = false;
  const start = (): void => {
    if (handle !== null) host.clear(handle);
    waiting = false;
    handle = host.set(() => {
      handle = null;
      onExpire();
    }, ms);
  };
  return {
    show() {
      if (onScreen) start();
      else waiting = true;
    },
    visible() {
      if (onScreen) return;
      onScreen = true;
      if (waiting) start();
    },
    cancel() {
      if (handle !== null) host.clear(handle);
      handle = null;
      waiting = false;
    },
  };
}
