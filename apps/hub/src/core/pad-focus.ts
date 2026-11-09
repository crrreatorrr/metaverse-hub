/**
 * Controller focus for the hub's DOM overlays (login gate, menu, arcade picker, account panel).
 * The D-pad moves focus to the nearest control in that direction, A presses it, and range sliders
 * take left / right. `pickInDirection` is pure so the tests can check the geometry.
 */
import type { NavDir } from './gamepad';

export interface Box { left: number; top: number; width: number; height: number }

/**
 * Index of the box to move to from `from` toward `dir`, or -1. Candidates must lie in that
 * half-plane (by centre); the score favours the straight-ahead axis so a column of buttons
 * steps down the column instead of jumping sideways.
 */
export function pickInDirection(boxes: readonly Box[], from: number, dir: NavDir): number {
  const origin = boxes[from];
  if (!origin) return boxes.length ? 0 : -1;
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, index) => {
    if (index === from) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dx = cx - ox;
    const dy = cy - oy;
    let along: number;
    let across: number;
    switch (dir) {
      case 'up': along = -dy; across = dx; break;
      case 'down': along = dy; across = dx; break;
      case 'left': along = -dx; across = dy; break;
      case 'right': along = dx; across = dy; break;
    }
    if (along <= 1) return;
    const score = along + Math.abs(across) * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

const FOCUSABLE =
  'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

function visible(node: HTMLElement): boolean {
  if (node.closest('[hidden]')) return false;
  if ((node as HTMLButtonElement).disabled) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
}

const RING = 'pad-focus';

export interface PadFocus {
  /** Moves focus inside `root`. Focuses the first control when nothing inside is focused. */
  move(root: HTMLElement, dir: NavDir): void;
  /** A: presses the focused control (or focuses the first one). */
  activate(root: HTMLElement): void;
  /** Drops the controller ring (mouse or keyboard took over). */
  clear(): void;
}

export function createPadFocus(): PadFocus {
  let ringed: HTMLElement | null = null;

  function ring(node: HTMLElement): void {
    if (ringed && ringed !== node) ringed.classList.remove(RING);
    ringed = node;
    node.classList.add(RING);
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function current(root: HTMLElement, list: readonly HTMLElement[]): number {
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) {
      const index = list.indexOf(active);
      if (index >= 0) return index;
    }
    return -1;
  }

  function nudgeRange(input: HTMLInputElement, dir: NavDir): boolean {
    if (input.type !== 'range' || (dir !== 'left' && dir !== 'right')) return false;
    if (dir === 'left') input.stepDown();
    else input.stepUp();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  return {
    move(root, dir) {
      const list = focusablesIn(root);
      if (!list.length) return;
      const from = current(root, list);
      if (from < 0) {
        ring(list[0]);
        return;
      }
      const node = list[from];
      if (node instanceof HTMLInputElement && nudgeRange(node, dir)) {
        ring(node);
        return;
      }
      let next = pickInDirection(list.map((item) => item.getBoundingClientRect()), from, dir);
      // Nothing that way geometrically: step through the tab order so long lists still scroll.
      if (next < 0 && (dir === 'down' || dir === 'right')) next = from + 1 < list.length ? from + 1 : -1;
      if (next < 0 && (dir === 'up' || dir === 'left')) next = from - 1;
      if (next >= 0) ring(list[next]);
      else ring(node);
    },
    activate(root) {
      const list = focusablesIn(root);
      const from = current(root, list);
      if (from < 0) {
        if (list[0]) ring(list[0]);
        return;
      }
      const node = list[from];
      ring(node);
      if (node instanceof HTMLInputElement && node.type === 'checkbox') node.click();
      else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
        // Text fields keep focus so a device keyboard (Steam Deck, console browser) can open.
        if (node instanceof HTMLInputElement && node.type === 'color') node.click();
        else if (node instanceof HTMLInputElement && node.type === 'submit') node.click();
      } else node.click();
    },
    clear() {
      ringed?.classList.remove(RING);
      ringed = null;
    },
  };
}
