/**
 * The viewer's link to the organization's HQ, the one value every surface reads of it: `live`
 * while HQ's stream and its navigation are; `restarting` since HQ ended the stream as planned
 * (`4410`) and the next did not open; `unreachable` since it was lost any other way, or before it
 * ever answered (`since` null). HQ's refusal is its answer, not an outage: the navigation's
 * `refusal` says it, and the link reads live. HQ being away is a fact about this link, never
 * evidence about a Mate: what HQ said stands until a live HQ says otherwise.
 *
 * Only the menu's header says it, and only past {@link HQ_AWAY_BUDGET_MS}, longer than a deploy:
 * shorter, nothing on screen changes. An HQ write while it is away is answered at once
 * ({@link hqAwayAnswer}); controls stay as they are.
 *
 * @module data/projections/hqLink
 */
import { hqAppsScope } from "../families/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import { liveOrHeld, type StreamState } from "../streamMachine.ts";

export type HqLink =
  | { readonly kind: "live" }
  | { readonly kind: "restarting"; readonly since: number }
  /** `since` null: lost before it ever answered here. */
  | { readonly kind: "unreachable"; readonly since: number | null };

const LIVE: HqLink = { kind: "live" };

/**
 * How long HQ may be away before the menu says so: a restart (an HQ deploy, 34–50 s) gets a
 * deploy's span with room; a link lost any other way is said sooner.
 */
export const HQ_AWAY_BUDGET_MS = { restarting: 120_000, unreachable: 30_000 } as const;

export function hqLinkOf(read: ProjectionReads, orgId: string): HqLink {
  const link = read.stream(linkKeys.hq(orgId));
  const navigation = read.stream(hqAppsScope(orgId));
  const streams: ReadonlyArray<StreamState> = [link, navigation];
  if (
    streams.some((stream) => stream.phase === "refused") ||
    (link.phase === "live" && liveOrHeld(navigation))
  )
    return LIVE;
  const lost = streams.flatMap((stream) => (stream.lostAt === undefined ? [] : [stream.lostAt]));
  const since = lost.length === 0 ? null : Math.min(...lost);
  return link.restarting === true && since !== null
    ? { kind: "restarting", since }
    : { kind: "unreachable", since };
}

/** When the menu says HQ is away (wall ms); `null` while it is live or was never read here. */
export function hqAwaySaidAt(link: HqLink): number | null {
  if (link.kind === "live" || link.since === null) return null;
  return link.since + HQ_AWAY_BUDGET_MS[link.kind];
}

/** What an HQ write answers at once while HQ is away; `null` while it is live. */
export function hqAwayAnswer(link: HqLink): string | null {
  switch (link.kind) {
    case "live":
      return null;
    case "restarting":
      return "HQ is restarting. Try again shortly.";
    case "unreachable":
      return "HQ is not reachable. Try again shortly.";
  }
}
