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
  /** The word is HQ's answer now: only then does a record saying "not closed off" stand. */
  readonly current: boolean;
  /** The projects HQ says are closed off: a fact that never reverts, so a stale word keeps it. */
  readonly closed: ReadonlySet<string>;
  /** The Mates whose record says their project is not closed off. */
  readonly open: ReadonlySet<string>;
}

/** The close-off word of an HQ structure, current or as last known. */
export function closeOffWordOf(
  organizationId: string,
  structure: HqStructure,
  current: boolean,
): CloseOffWord {
  const closed = new Set<string>();
  const open = new Set<string>();
  const mates = [...structure.ungrouped, ...structure.apps.flatMap((app) => app.projects)];
  for (const { projectId, mate } of mates) {
    if (mate === null) continue;
    if (mate.closedOff === true) closed.add(projectId);
    else if (mate.closedOff === false) open.add(projectId);
  }
  return { organizationId, current, closed, open };
}

/** The tag 0.12.3's close-off wrote on the project (`isZeropsMateClosedOff`). */
export const LEGACY_CLOSED_OFF_TAG = "mate:closed-off";

/**
 * Whether a project is closed off: HQ's word, or the 0.12 tag on the project itself; `unknown`
 * where neither says — HQ's word not current, an older HQ silent on it, another organization, or
 * a project its structure lacks (its view may be a moment behind), never "not closed off".
 */
export function closedOffOf(
  word: CloseOffWord | null,
  organizationId: string,
  projectId: string,
  tagList?: ReadonlyArray<string>,
): boolean | "unknown" {
  if (tagList?.includes(LEGACY_CLOSED_OFF_TAG) === true) return true;
  if (word === null || word.organizationId !== organizationId) return "unknown";
  if (word.closed.has(projectId)) return true;
  return word.current && word.open.has(projectId) ? false : "unknown";
}

/** How long after its container is made a Mate may still be in its press's hands. */
export const ZCP_YOUNG_MS = 2 * 60 * 60_000;

/** A container made within {@link ZCP_YOUNG_MS}; one of no known age is not young. */
export function zcpYoung(created: string | undefined, nowMs: number): boolean {
  const at = created === undefined ? Number.NaN : Date.parse(created);
  return !Number.isNaN(at) && nowMs - at < ZCP_YOUNG_MS;
}

/** Why a Mate is held (`closeOffGate`), each said where the Mate is opened. */
export type CloseOffHold =
  /** Its container carries the press's marker and HQ says it is not closed off: *Finish setup*. */
  | "open"
  /** HQ says it is not closed off, and its container's marker is being read. */
  | "checking"
  /** HQ says nothing now, and this browser knows its close-off has not happened. */
  | "awaiting-hq";

/**
 * Whether a listed Mate may be connected, or why it is held — never on no fact:
 *
 * - closed off — HQ's word or a 0.12 tag — or no press marker on its container (a Mate made
 *   before the press closed projects off): `connect`;
 * - HQ's current record says it is not closed off: held `open` once its marker is read present,
 *   `checking` while it is read — before it could connect for a moment — and, where the stream
 *   could not say, only while it is young: an older Mate is never held on a stalled stream;
 * - HQ says nothing (down, no official HQ, another organization, missing from its structure):
 *   held `awaiting-hq` only where this browser knows its close-off has not happened (a press here
 *   that stopped before it, or runs), else `connect`.
 */
export function closeOffGate(input: {
  readonly marker: boolean | "unknown" | "unread";
  readonly closedOff: boolean | "unknown";
  readonly young: boolean;
  /** This browser knows the project's close-off has not happened (`closeOffPending`). */
  readonly pendingHere: boolean;
}): "connect" | CloseOffHold {
  if (input.closedOff === true || input.marker === false) return "connect";
  if (input.closedOff === false) {
    if (input.marker === true) return "open";
    if (input.marker === "unread") return "checking";
    return input.young ? "checking" : "connect";
  }
  return input.pendingHere ? "awaiting-hq" : "connect";
}
