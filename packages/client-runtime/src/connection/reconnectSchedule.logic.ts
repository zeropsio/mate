/**
 * How long a person's connection to a Mate waits before asking for its next ticket (spec-mate
 * §3.8): a reconnect is a new ticket, 2, 4, 8, 15 and 30 s apart, then steady at 60 s for the Mate
 * on screen and 5 min for one in the background. The supervisor runs the wait; a wake, the network
 * or a change of the Mate's state releases it, and a hidden tab holds it until it is seen again.
 */

/** The waits after the first five failures, in order. */
const LADDER_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;
const STEADY_ON_SCREEN_MS = 60_000;
const STEADY_BACKGROUND_MS = 300_000;

/** The wait after `failures` consecutive failed attempts (1 for the first). */
export function reconnectWaitMs(failures: number, onScreen: boolean): number {
  return (
    LADDER_MS[Math.max(0, failures - 1)] ?? (onScreen ? STEADY_ON_SCREEN_MS : STEADY_BACKGROUND_MS)
  );
}
