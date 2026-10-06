/**
 * The close-off gate (restores 0.12.3's `closeOffGate` inside the lease model): nobody is let into
 * a Mate before its project is closed off, and *Finish setup* does that. A press imports the
 * Mate's container with its marker (`MATE_SETUP_RUNTIMES`) and then closes the project off, which
 * HQ records (`markClosedOff`); a tab closed between the two leaves a Mate whose project's
 * environment variables are not isolated. Such a Mate holds no lease's connection until HQ says
 * its project is closed off. HQ's word alone says it (ADR 0002): no project tag, and no clock in
 * place of the word (2026-10-05).
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
    if (mate == null) continue;
    if (mate.closedOff === true) closed.add(projectId);
    else if (mate.closedOff === false) open.add(projectId);
  }
  return { organizationId, current, closed, open };
}

/**
 * Whether a project is closed off, as HQ says it; `unknown` where it does not — its word not
 * current, a record silent on it, another organization, or a project its structure lacks (its view
 * may be a moment behind), never "not closed off".
 */
export function closedOffOf(
  word: CloseOffWord | null,
  organizationId: string,
  projectId: string,
): boolean | "unknown" {
  if (word === null || word.organizationId !== organizationId) return "unknown";
  if (word.closed.has(projectId)) return true;
  return word.current && word.open.has(projectId) ? false : "unknown";
}

/** Why a Mate is held (`closeOffGate`), each said where the Mate is opened. */
export type CloseOffHold =
  /** Its container carries the press's marker and HQ says it is not closed off: *Finish setup*. */
  | "open"
  /** HQ says it is not closed off, and its container's marker is not read yet, or could not be. */
  | "checking"
  /** HQ says nothing now, and this browser knows its close-off has not happened. */
  | "awaiting-hq";

/**
 * Whether a listed Mate may be connected, or why it is held — never on no fact:
 *
 * - closed off by HQ's word, or no press marker on its container (a Mate made before the press
 *   closed projects off): `connect`;
 * - HQ's current record says it is not closed off: held `open` once its marker is read present,
 *   else `checking` — before it could connect for a moment, and for as long as its marker cannot
 *   be read: HQ's word decides, however old its container;
 * - HQ says nothing (down, no official HQ, another organization, missing from its structure):
 *   held `awaiting-hq` only where this browser knows its close-off has not happened (a press here
 *   that stopped before it, or runs), else `connect`.
 */
export function closeOffGate(input: {
  readonly marker: boolean | "unknown" | "unread";
  readonly closedOff: boolean | "unknown";
  /** This browser knows the project's close-off has not happened (`closeOffPending`). */
  readonly pendingHere: boolean;
}): "connect" | CloseOffHold {
  if (input.closedOff === true || input.marker === false) return "connect";
  if (input.closedOff === false) return input.marker === true ? "open" : "checking";
  return input.pendingHere ? "awaiting-hq" : "connect";
}
