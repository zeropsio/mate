/**
 * The one clock for work under way — a working Mate beside its name, a release on its way: in
 * units, as the conversation's clocks read ("42s", "7m 05s", "1h 04m"), so it never reads like
 * the time of day the same places show for what has ended. Seconds and minutes keep two digits,
 * so it ticks in a steady width.
 *
 * @module runClock
 */
export function formatRunClock(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}
