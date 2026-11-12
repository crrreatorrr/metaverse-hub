/**
 * Camera look settings kept per browser (plan item D7).
 *
 * The plaza has always used "inverted" vertical look (push the stick or mouse up, the camera
 * goes down). That stays the default; the switch in Menu → Items flips it.
 */
export const INVERT_LOOK_KEY = 'hub:look:invert';

export function parseInvertLook(stored: string | null): boolean {
  return stored !== '0';
}

export function loadInvertLook(): boolean {
  try {
    return parseInvertLook(localStorage.getItem(INVERT_LOOK_KEY));
  } catch {
    return true;
  }
}

export function saveInvertLook(inverted: boolean): void {
  try {
    localStorage.setItem(INVERT_LOOK_KEY, inverted ? '1' : '0');
  } catch {
    // Storage may be off (private window). The switch still applies for this visit.
  }
}

/** Vertical look input as the camera takes it. `vertical` is in the plaza's original (inverted) sense. */
export function lookVertical(vertical: number, inverted: boolean): number {
  return inverted ? vertical : -vertical;
}
