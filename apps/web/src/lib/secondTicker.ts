/**
 * One clock for every duration that counts up on screen — a working Mate's
 * time in the menu, a run's elapsed in the conversation. Each used to run its
 * own one-second interval, started whenever it mounted: N clocks were N
 * separate style-and-layout passes a second. This one ticks on the wall
 * clock's second and tells every listener in the same task, so they all land
 * in one pass. No listener, no timer.
 */
type SecondListener = (nowMs: number) => void;

const listeners = new Set<SecondListener>();
let timer: ReturnType<typeof setTimeout> | undefined;
let nowMs: number | undefined;

/** The last clock observation, stable between subscriptions and ticks. */
export function secondSnapshot(): number {
  return (nowMs ??= Date.now());
}

function schedule(): void {
  timer = setTimeout(tick, 1000 - (Date.now() % 1000));
}

function tick(): void {
  timer = undefined;
  const observedAt = Date.now();
  nowMs = observedAt;
  for (const listener of [...listeners]) {
    if (listeners.has(listener)) listener(observedAt);
  }
  // A synchronous subscriber may mount its replacement while being notified.
  if (listeners.size > 0 && timer === undefined) schedule();
}

/** Calls `listener` on every wall-clock second until the returned function is called. */
export function subscribeSecond(listener: SecondListener): () => void {
  if (listeners.size === 0) nowMs = Date.now();
  listeners.add(listener);
  if (timer === undefined) schedule();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      nowMs = undefined;
    }
  };
}
