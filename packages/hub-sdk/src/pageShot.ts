// The HTML half of the feedback screenshot (docs/feedback.md). The canvases are copied in
// feedback.ts; this draws the rest of the page (menus, HUD, panels: plain HTML in most games) into
// a whole-viewport canvas, transparent where the canvases show through, to lay over them.
//
// The drawing is done by modern-screenshot, vendored in ./third_party (MIT). It is a separate
// module loaded on demand, and fetched a few seconds after start so the first N-N does not wait.

type Library = typeof import('./third_party/modern-screenshot.js');

let library: Promise<Library> | null = null;

/** Load the HTML-drawing library (once). A failed load is retried on the next call. */
export function loadPageShot(): Promise<Library> {
  library ??= import('./third_party/modern-screenshot.js').catch((error: unknown) => {
    library = null;
    throw error;
  });
  return library;
}

/**
 * Hold `requestAnimationFrame` callbacks until the returned function is called, then hand them to
 * the browser. The library yields between nodes, and a game frame drawn in each gap made the copy
 * many times slower (seconds instead of a fraction of one). The screen keeps the last frame.
 */
function holdFrames(): () => void {
  const w = window;
  const request = w.requestAnimationFrame;
  const cancel = w.cancelAnimationFrame;
  const queued = new Map<number, FrameRequestCallback>();
  let next = 0;
  w.requestAnimationFrame = (callback) => {
    next -= 1;
    queued.set(next, callback);
    return next;
  };
  w.cancelAnimationFrame = (handle) => {
    if (!queued.delete(handle)) cancel.call(w, handle);
  };
  let released = false;
  return () => {
    if (released) return;
    released = true;
    w.requestAnimationFrame = request;
    w.cancelAnimationFrame = cancel;
    for (const callback of queued.values()) request.call(w, callback);
  };
}

/**
 * Draw `root` (normally document.body) as the viewport shows it, leaving out `skip` (the canvases
 * already copied, the feedback window) and anything not displayed. Call it in the frame the
 * screenshot is taken: other canvases inside `root`, such as a WebGL preview in a menu, are copied
 * straight away, while their frame is still there. Game frames are held for at most `holdMs`.
 */
export function capturePage(root: HTMLElement, skip: readonly Element[], maxWidth: number, holdMs: number): Promise<HTMLCanvasElement | null> {
  // A WebGL canvas without preserveDrawingBuffer is blank once this frame is shown. Copy each one
  // now with drawImage (about 1 ms; toDataURL on WebGL stalls on the GPU, for seconds in a
  // software-rendered browser) and answer the library's later read from the copy.
  const frozen: HTMLCanvasElement[] = [];
  for (const canvas of Array.from(root.querySelectorAll('canvas'))) {
    if (skip.includes(canvas) || !canvas.width || !canvas.height) continue;
    try {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const g = copy.getContext('2d');
      if (!g) continue;
      g.drawImage(canvas, 0, 0);
      canvas.toDataURL = (...args: Parameters<HTMLCanvasElement['toDataURL']>) => copy.toDataURL(...args);
      frozen.push(canvas);
    } catch {
      // A lost or tainted canvas: the library skips it.
    }
  }
  const release = holdFrames();
  const deadline = window.setTimeout(release, holdMs);
  const done = () => {
    window.clearTimeout(deadline);
    release();
    for (const canvas of frozen) delete (canvas as { toDataURL?: unknown }).toDataURL;
  };
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  return loadPageShot()
    .then(({ domToCanvas }) =>
      domToCanvas(root, {
        width,
        height,
        scale: Math.min(1, maxWidth / width),
        backgroundColor: null,
        // The root's own background is behind the canvases on the page, not over them.
        style: { background: 'transparent' },
        timeout: holdMs,
        filter: (node) => !(node instanceof Element) || (!skip.includes(node) && node.checkVisibility()),
      }),
    )
    .catch(() => null)
    .finally(done);
}

/** The colour behind everything on the page, for the parts no canvas or element covers. */
export function pageBackground(): string {
  for (const node of [document.body, document.documentElement]) {
    if (!node) continue;
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return '#000';
}
