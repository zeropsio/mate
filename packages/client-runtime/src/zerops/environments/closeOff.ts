/**
 * The close-off gate (restores 0.12.3's `closeOffGate` inside the lease model): nobody is let into
 * a Mate before its project is closed off, and *Finish setup* does that. A press imports the
 * Mate's container with its marker (`MATE_SETUP_RUNTIMES`) and then closes the project off, which
 * HQ records (`markClosedOff`); a tab closed between the two leaves a Mate whose project's
 * environment variables are not isolated. Such a Mate holds no lease's connection until HQ says
 * its project is closed off.
 */
import type { HqStructure } from "../hq/client.ts";

/** HQ's word on whether each Mate's project is closed off, in the organization it speaks for. */
export interface CloseOffWord {
  readonly organizationId: string;
  /** The word is HQ's answer now: a project it does not say is closed off is not. */
  readonly current: boolean;
  /** The projects HQ says are closed off: a fact that never reverts, so a stale word keeps it. */
  readonly closed: ReadonlySet<string>;
  /** The Mates an older HQ keeps no close-off for: nothing is said of them. */
  readonly silent: ReadonlySet<string>;
}

/** The close-off word of an HQ structure, current or as last known. */
export function closeOffWordOf(
  organizationId: string,
  structure: HqStructure,
  current: boolean,
): CloseOffWord {
  const closed = new Set<string>();
  const silent = new Set<string>();
  const mates = [...structure.ungrouped, ...structure.apps.flatMap((app) => app.projects)];
  for (const { projectId, mate } of mates) {
    if (mate === null) continue;
    if (mate.closedOff === true) closed.add(projectId);
    else if (mate.closedOff === undefined) silent.add(projectId);
  }
  return { organizationId, current, closed, silent };
}

/** Whether a project is closed off, as HQ's word says it: `unknown` where it says nothing now. */
export function closedOffOf(
  word: CloseOffWord | null,
  organizationId: string,
  projectId: string,
): boolean | "unknown" {
  if (word === null || word.organizationId !== organizationId) return "unknown";
  if (word.closed.has(projectId)) return true;
  if (!word.current || word.silent.has(projectId)) return "unknown";
  return false;
}

/** How long after its container is made a Mate may still be in its press's hands. */
export const ZCP_YOUNG_MS = 2 * 60 * 60_000;

/** A container made within {@link ZCP_YOUNG_MS}; one of no known age is not young. */
export function zcpYoung(created: string | undefined, nowMs: number): boolean {
  const at = created === undefined ? Number.NaN : Date.parse(created);
  return !Number.isNaN(at) && nowMs - at < ZCP_YOUNG_MS;
}

/**
 * Whether a listed Mate may be connected:
 *
 * - `connect` — HQ says its project is closed off, or its container carries no press marker (a
 *   Mate made before the press closed projects off), or it is older than a press could still be
 *   setting it up and nobody can read what would hold it: a slow or stalled stream, or HQ out,
 *   never stalls an older Mate;
 * - `open` — its container carries the press's marker and HQ's current word says its project is
 *   not closed off: held, and its row and page say why, offering *Finish setup*;
 * - `unsure` — a young container whose marker or HQ's word is not known yet: held quietly.
 */
export function closeOffGate(input: {
  readonly marker: boolean | "unknown" | "unread";
  readonly closedOff: boolean | "unknown";
  readonly young: boolean;
}): "connect" | "open" | "unsure" {
  if (input.closedOff === true || input.marker === false) return "connect";
  if (input.marker === true && input.closedOff === false) return "open";
  return input.young ? "unsure" : "connect";
}
