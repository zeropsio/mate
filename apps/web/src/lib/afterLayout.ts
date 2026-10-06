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
 * Asked while those run, or where there is no ResizeObserver (a test's page),
 * a callback runs at once.
 */
let waiting: Array<() => void> = [];
let watch: ResizeObserver | undefined;
let running = false;

export function afterLayout(callback: () => void): void {
  if (running || typeof ResizeObserver !== "function" || typeof document === "undefined") {
    callback();
    return;
  }
  waiting.push(callback);
  if (waiting.length > 1) return;
  watch ??= new ResizeObserver(() => {
    const due = waiting;
    waiting = [];
    running = true;
    try {
      for (const run of due) run();
    } finally {
      running = false;
    }
  });
  const root = document.documentElement;
  watch.unobserve(root);
  watch.observe(root);
}
