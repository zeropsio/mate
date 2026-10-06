/**
 * A turn once the page is laid out, before it paints.
 *
 * A box read while the page's last change is not laid out yet forces that
 * layout there and then, and again after any write that follows it. Read in a
 * ResizeObserver's callback, it costs nothing: the browser calls those right
 * after it lays the page out for a frame and before it paints, and an element
 * observed anew is reported once. So one observer on the page's root, observed
 * anew, runs everything that asked since, in the same frame.
 *
 * The root is observed anew from the frame's own callbacks, before the browser
 * lays the frame out: observed while the observers deliver — a draw flushed
 * inside a list's measuring asks from there — the browser skips it for the
 * frame and reports a loop error. Asked from a task, the next frame's
 * callbacks come before its layout, so it still runs in the frame that paints
 * what asked; asked from inside a frame, it runs the next one.
 *
 * Asked while those run, or where there is no ResizeObserver (a test's page),
 * a callback runs at once. One that throws is reported, and the rest run.
 */
let waiting: Array<() => void> = [];
let watch: ResizeObserver | undefined;
let running = false;

export function afterLayout(callback: () => void): void {
  if (
    running ||
    typeof ResizeObserver !== "function" ||
    typeof requestAnimationFrame !== "function" ||
    typeof document === "undefined"
  ) {
    callback();
    return;
  }
  waiting.push(callback);
  if (waiting.length > 1) return;
  requestAnimationFrame(observeRoot);
}

function observeRoot(): void {
  watch ??= new ResizeObserver(runWaiting);
  const root = document.documentElement;
  watch.unobserve(root);
  watch.observe(root);
}

function runWaiting(): void {
  const due = waiting;
  waiting = [];
  running = true;
  try {
    for (const run of due) {
      try {
        run();
      } catch (error) {
        report(error);
      }
    }
  } finally {
    running = false;
  }
}

/** A callback's throw reaches the page as an uncaught error would, without stopping the others. */
function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else
    queueMicrotask(() => {
      throw error;
    });
}
