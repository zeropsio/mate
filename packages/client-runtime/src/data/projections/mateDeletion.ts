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
import type { HqOperation } from "../../zerops/hq/client.ts";
import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";
import type { WaitingWords } from "./operationFailure.ts";
import { hqOperationOf } from "./hqOperation.ts";

/** HQ's kind of a Mate's deletion. */
const MATE_DELETION = "mate_deletion";
const APP_DELETION = "app_deletion";

export type MateDeletion =
  /** Nothing deletes it. */
  | { readonly kind: "none" }
  /** HQ's deletion runs, or Zerops deletes its project: it opens nowhere and offers nothing. */
  | { readonly kind: "deleting" }
  /**
   * HQ's deletion `id` stopped open for its maker: it waits for their Continue
   * (`continueBy`, a Zerops user id); `yours` where HQ offers the person reading that Continue.
   */
  | (WaitingWords & {
      readonly kind: "waiting";
      readonly id: string;
      readonly continueBy: string;
      readonly yours: boolean;
      readonly endable?: true;
    })
  /**
   * HQ's deletion stopped with a failure: the Mate stands, Delete again. The failure is HQ's as
   * sent, including who stopped it and Zerops' answer where it refused.
   */
  | { readonly kind: "failed"; readonly failure: HqOperationFailure };

export interface MateDeletionEvidence {
  /** The operation HQ's navigation shows on the Mate's project; absent where it shows none. */
  readonly operation: HqOperation | undefined;
  /** Its project's status in the person's Zerops listing; absent where the listing lacks it. */
  readonly status: string | undefined;
}

const NONE: MateDeletion = { kind: "none" };
const DELETING: MateDeletion = { kind: "deleting" };

export function mateDeletionOf(evidence: MateDeletionEvidence): MateDeletion {
  const kind = evidence.operation?.kind === APP_DELETION ? APP_DELETION : MATE_DELETION;
  const deletion = hqOperationOf(evidence.operation, kind);
  // Its wait for its maker's fresh token outlives Zerops deleting the project, as the steps after
  // it (the key's retirement) do.
  if (deletion.kind === "waiting") return deletion;
  // Zerops deletes its project, whoever asked: nothing HQ says of it can open it again.
  if (evidence.status !== undefined && PROJECT_GOING_STATUSES.has(evidence.status)) return DELETING;
  // A Mate's deletion ends at no decision of the person's.
  if (deletion.kind === "none" || deletion.kind === "needs") return NONE;
  if (kind === APP_DELETION && deletion.kind === "failed") return NONE;
  if (deletion.kind === "going") return DELETING;
  return deletion;
}

/** A Mate's deletion from its project as the listing joins HQ's placement onto it. */
export const mateDeletionOfProject = (project: {
  readonly status: string;
  readonly hq?: { readonly operation?: HqOperation | undefined } | undefined;
}): MateDeletion => mateDeletionOf({ operation: project.hq?.operation, status: project.status });

/** It is on its way off Zerops: it opens nowhere, offers nothing, and nobody signs it in. */
export const mateGoing = (deletion: MateDeletion): boolean =>
  deletion.kind === "deleting" || deletion.kind === "waiting";
