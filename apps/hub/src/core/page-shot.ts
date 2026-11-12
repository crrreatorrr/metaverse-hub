// The HTML half of the N-N feedback screenshot (docs/feedback.md). The SDK copies only canvases,
// so the plaza's HTML (HUD, login, menus, chat, boards) would be missing and only the 3D world
// behind it would show. This draws the page's HTML into a whole-viewport canvas, transparent
// where the world shows through, for the SDK to lay over the world canvas.
//
// The library is fetched a few seconds after startup, off the first screenshot's clock.

/** About the width of the SDK's screenshot (960 px): no time spent on pixels thrown away. */
const TARGET_WIDTH = 960;
const TIMEOUT_MS = 2000;

/**
 * True while the HTML is being copied. The world loop skips its draw then: the copy yields between
 * nodes, and a 3D frame drawn in each gap made it many times slower. The screen keeps showing the
 * last frame and the plaza keeps running.
 */
export const pageShotHold = { held: false };

let library: Promise<typeof import('modern-screenshot')> | null = null;
const loadLibrary = () => {
  library ??= import('modern-screenshot').catch((error: unknown) => {
    library = null;
    throw error;
  });
  return library;
};

/** Fetch the library once the hub has started, so the first screenshot does not wait for it. */
export function preloadPageShot(delayMs = 5000): void {
  window.setTimeout(() => void loadLibrary().catch(() => {}), delayMs);
}

/**
 * Draw `root` and its HTML, leaving out `skip` (the world canvas, which the SDK copies itself) and
 * anything not displayed. Call it in the frame the screenshot is taken: other WebGL canvases inside
 * `root` are read straight away, while their frame is still there, and the rest is drawn after.
 */
export function captureHtml(root: HTMLElement | null, skip: readonly Element[] = []): Promise<HTMLCanvasElement | null> {
  if (!root) return Promise.resolve(null);
  // A WebGL canvas without preserveDrawingBuffer is blank once this frame is shown. Read each one
  // now and answer the library's later read with that copy.
  const frozen: HTMLCanvasElement[] = [];
  for (const canvas of root.querySelectorAll('canvas')) {
    if (skip.includes(canvas)) continue;
    try {
      const url = canvas.toDataURL();
      canvas.toDataURL = () => url;
      frozen.push(canvas);
    } catch {
      // A tainted canvas: the library skips it too.
    }
  }
  pageShotHold.held = true;
  const done = () => {
    pageShotHold.held = false;
    for (const canvas of frozen) delete (canvas as { toDataURL?: unknown }).toDataURL;
  };
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  return loadLibrary()
    .then(({ domToCanvas }) =>
      domToCanvas(root, {
        width,
        height,
        scale: Math.min(1, TARGET_WIDTH / width),
        backgroundColor: null,
        // The root's own background sits behind the world canvas on the page, not over it.
        style: { background: 'transparent' },
        timeout: TIMEOUT_MS,
        filter: (node) => !(node instanceof Element) || (!skip.includes(node) && node.checkVisibility()),
      }),
    )
    .catch((error: unknown) => {
      console.warn('[feedback] could not draw the page into the screenshot', error);
      return null;
    })
    .finally(done);
}
