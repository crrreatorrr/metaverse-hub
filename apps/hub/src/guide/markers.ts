/**
 * Gate markers (plan item D2): a label at the screen edge (or over the entrance when it is in view)
 * for each game entrance and the Bar, with the distance in metres. Pure maths; the shell feeds it
 * camera-space points and paints the result.
 */
export interface Waypoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}

/** The Bar has no ring of its own: its marker names the three games on the cabinet inside. */
export const BAR_MARKER_LABEL = 'Bar: Arcade · Fighter · Coop Battle';

/** Fully visible from here out (m). */
export const MARKER_FADE_FAR = 20;
/** Gone inside this (m): you are at the entrance and its own sign and hint take over. */
export const MARKER_FADE_NEAR = 14;

export function markerOpacity(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const t = (distance - MARKER_FADE_NEAR) / (MARKER_FADE_FAR - MARKER_FADE_NEAR);
  return Math.min(1, Math.max(0, t));
}

export function markerText(label: string, distance: number): string {
  return `${label} · ${Math.max(0, Math.round(distance))} m`;
}

export interface MarkerMargins {
  top: number;
  bottom: number;
  /** Minimum distance of a label centre from the left and right edges. */
  side: number;
  /** Extra room kept free on the right (a card is showing there). */
  rightInset?: number;
}

export interface MarkerPlace {
  x: number;
  y: number;
  /** Clamped to a screen edge: the entrance is out of view. */
  edge: boolean;
}

/**
 * Screen position for a point in camera space (x right, y up, the camera looks down -z).
 * A point in view lands on itself; anything else is pushed to the nearest edge along its bearing,
 * inside the margins (the bottom margin keeps markers clear of the hint bar).
 */
export function placeMarker(
  cam: { x: number; y: number; z: number },
  fovYRadians: number,
  viewport: { width: number; height: number },
  margins: MarkerMargins,
): MarkerPlace {
  const half = Math.tan(fovYRadians / 2);
  const aspect = viewport.width / Math.max(1, viewport.height);
  const left = margins.side;
  const right = Math.max(left, viewport.width - margins.side - (margins.rightInset ?? 0));
  const top = margins.top;
  const bottom = viewport.height - margins.bottom;
  let ndcX: number;
  let ndcY: number;
  let behind = false;
  if (cam.z < -0.01) {
    ndcX = cam.x / (-cam.z * half * aspect);
    ndcY = cam.y / (-cam.z * half);
  } else {
    // Behind the camera: only the sideways bearing matters. Push it far out so the clamp picks the edge.
    behind = true;
    const side = Math.abs(cam.x) < 0.01 ? 1 : Math.sign(cam.x);
    ndcX = side * 1e6;
    ndcY = 0;
  }
  const rawX = (ndcX * 0.5 + 0.5) * viewport.width;
  const rawY = (-ndcY * 0.5 + 0.5) * viewport.height;
  const x = Math.min(right, Math.max(left, rawX));
  const y = behind ? (top + bottom) / 2 : Math.min(bottom, Math.max(top, rawY));
  const edge = behind || x !== rawX || y !== rawY;
  return { x, y, edge };
}

/**
 * Nudge markers apart vertically so no two labels overlap. `items` are label centres with sizes;
 * the nearest waypoint keeps its place. Returns the new y for each item, in input order.
 */
export function spreadMarkers(
  items: readonly { x: number; y: number; width: number; height: number; distance: number }[],
  bounds: { top: number; bottom: number },
  gap = 4,
): number[] {
  const order = items.map((_, index) => index).sort((a, b) => items[a]!.distance - items[b]!.distance);
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  const out = items.map((item) => item.y);
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
  for (const index of order) {
    const item = items[index]!;
    const candidate = { x: item.x, y: item.y, width: item.width, height: item.height };
    // Try the wanted row, then rows above and below it, nearest first.
    const step = item.height + gap;
    let found = false;
    for (let n = 0; n < 24 && !found; n += 1) {
      for (const dir of n === 0 ? [0] : [-1, 1]) {
        const y = item.y + dir * n * step;
        if (y < bounds.top || y > bounds.bottom) continue;
        candidate.y = y;
        if (!placed.some((other) => overlaps(candidate, other))) {
          found = true;
          break;
        }
      }
    }
    if (!found) candidate.y = Math.min(bounds.bottom, Math.max(bounds.top, item.y));
    placed.push({ ...candidate });
    out[index] = candidate.y;
  }
  return out;
}
