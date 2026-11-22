/**
 * How a Mate's deletion stands: the one answer the menu's row, the Mate's card and page, its
 * opening and its sign-in waits render. HQ runs the deletion as its operation `mate_deletion`
 * (`mate-hq spec/protocol.md` S13c) and shows it on the project in navigation, to every device and
 * every person who reads the project, until it releases the Mate's records; Zerops' own listing
 * says `DELETING` for a delete HQ did not start (the Zerops GUI's, an API token's).
 *
 * Pure: no network (rule R1).
 *
 * @module data/projections/mateDeletion
 */
import { PROJECT_GOING_STATUSES } from "../../zerops/mateEnvironments.ts";
import type { HqProjectOperation } from "../../zerops/hq/client.ts";

/** HQ's kind of a Mate's deletion. */
const MATE_DELETION = "mate_deletion";
/** HQ's failure code of an operation whose token was refused or lapsed: it waits for its maker. */
const TOKEN_EXPIRED = "token_expired";

export type MateDeletion =
  /** Nothing deletes it. */
  | { readonly kind: "none" }
  /** HQ's deletion runs, or Zerops deletes its project: it opens nowhere and offers nothing. */
  | { readonly kind: "deleting" }
  /**
   * HQ's deletion stopped open because its maker's token lapsed: it waits for their Continue
   * (`continueBy`, a Zerops user id); `yours` where that is the person reading.
   */
  | { readonly kind: "waiting"; readonly continueBy: string; readonly yours: boolean }
  /** HQ's deletion ended at `step` with Zerops' or HQ's `code`: the Mate stands, Delete again. */
  | { readonly kind: "failed"; readonly step: string; readonly code: string };

export interface MateDeletionEvidence {
  /** The operation HQ's navigation shows on the Mate's project; absent where it shows none. */
  readonly operation: HqProjectOperation | undefined;
  /** Its project's status in the person's Zerops listing; absent where the listing lacks it. */
  readonly status: string | undefined;
  /** The person reading, by Zerops user id; absent before the session names them. */
  readonly viewer: string | undefined;
}

const NONE: MateDeletion = { kind: "none" };
const DELETING: MateDeletion = { kind: "deleting" };

export function mateDeletionOf(evidence: MateDeletionEvidence): MateDeletion {
  // Zerops deletes its project, whoever asked: nothing HQ says of it can open it again.
  if (evidence.status !== undefined && PROJECT_GOING_STATUSES.has(evidence.status)) return DELETING;
  const { operation } = evidence;
  const deletion = operation?.kind === MATE_DELETION ? operation : undefined;
  if (deletion === undefined) return NONE;
  if (deletion.failure === undefined) return DELETING;
  // HQ names its maker only while the deletion stands open waiting for their fresh token.
  if (deletion.failure.code === TOKEN_EXPIRED && deletion.continueBy !== undefined)
    return {
      kind: "waiting",
      continueBy: deletion.continueBy,
      yours: deletion.continueBy === evidence.viewer,
    };
  return { kind: "failed", step: deletion.failure.step, code: deletion.failure.code };
}

/** A Mate's deletion from its project as the listing joins HQ's placement onto it. */
export const mateDeletionOfProject = (
  project: {
    readonly status: string;
    readonly hq?: { readonly operation?: HqProjectOperation | undefined } | undefined;
  },
  viewer: string | undefined,
): MateDeletion =>
  mateDeletionOf({ operation: project.hq?.operation, status: project.status, viewer });

/** It is on its way off Zerops: it opens nowhere, offers nothing, and nobody signs it in. */
export const mateGoing = (deletion: MateDeletion): boolean =>
  deletion.kind === "deleting" || deletion.kind === "waiting";
