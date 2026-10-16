import type { UnavailableReason } from "@t3tools/client-runtime/data";

/**
 * What the projects page says in place of its containers' count while it cannot sort every Mate
 * into its project: which project holds a Mate is HQ's to say, and HQ has not said it. In the
 * person's words — their projects, not loaded yet, and the one thing they can do where there is
 * one — never the engine's ("placement") or the team's server by name: a newcomer just used
 * Zerops' own site, and "HQ unavailable" read as Zerops being down.
 *
 * `undefined` once every Mate's project is known.
 */
export function placementNotice(
  status: {
    readonly complete: boolean;
    readonly reconnecting: boolean;
    readonly unavailableReason?: UnavailableReason | undefined;
  },
  /** HQ's stream is catching up or its retries are capped. */
  notAnswering: boolean,
): string | undefined {
  if (status.complete && status.unavailableReason === undefined) return undefined;
  switch (status.unavailableReason) {
    case "expired-session":
      return "Projects not loaded — sign in again";
    case "forbidden":
      return "Projects not loaded — your account can't see them";
    case "refused":
      return "Projects not loaded — they couldn't be read";
    case undefined:
      return notAnswering ? "Projects not loaded yet — trying again" : "Loading your projects…";
  }
}
