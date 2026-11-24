/** A bubble on screen: `x` is its centre, `y` its bottom edge (pixels, y down). */
export interface BubbleBox { x: number; y: number; w: number; h: number }

/**
 * How far up (pixels) to move each bubble so none covers another: speakers standing together
 * (the sims' ring, a crowd at a gate) get their lines stacked instead of printed on top of each
 * other. The lowest bubble on screen keeps its place and the ones it would cover go above it.
 */
export function stackBubbles(boxes: readonly BubbleBox[], gap = 2): number[] {
  const order = boxes.map((_, index) => index).sort((a, b) => boxes[b]!.y - boxes[a]!.y || a - b);
  const placed: BubbleBox[] = [];
  const lift = boxes.map(() => 0);
  for (const index of order) {
    const box = boxes[index]!;
    let y = box.y;
    // Each pass clears at least one placed bubble, so this ends within `placed.length` passes.
    for (let pass = 0; pass <= placed.length; pass += 1) {
      const hit = placed.find((other) =>
        Math.abs(other.x - box.x) < (other.w + box.w) / 2 && y > other.y - other.h - gap && y - box.h < other.y + gap);
      if (!hit) break;
      y = hit.y - hit.h - gap;
    }
    lift[index] = box.y - y;
    placed.push({ x: box.x, y, w: box.w, h: box.h });
  }
  return lift;
}
