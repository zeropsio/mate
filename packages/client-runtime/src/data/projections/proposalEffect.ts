/**
 * The approved proposal's effect HQ carries out on a project (`proposal_effect`, `mate-hq
 * spec/protocol.md` S19b), as navigation shows it on its target, to every device, while it runs:
 * an ended one is no longer shown, and HQ's decision record then holds how it ended.
 *
 * Pure: no network (rule R1).
 *
 * @module data/projections/proposalEffect
 */
import type { HqOperation } from "../../zerops/hq/client.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/** HQ's kind of an approved proposal's effect. */
export const PROPOSAL_EFFECT = "proposal_effect";

/** The proposal effect navigation shows open on the project; `undefined` where none is. */
export const proposalEffectOf: Projection<
  { readonly orgId: string; readonly projectId: string },
  HqOperation | undefined
> = {
  name: "proposalEffectOf",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    if (!read.members(placementsScope(orgId)).ids.includes(projectId)) return undefined;
    const placement = read.fact("placement", projectId);
    if (placement.kind !== "known") return undefined;
    const operation = placement.value.operation;
    return operation?.kind === PROPOSAL_EFFECT ? operation : undefined;
  },
  equals: sameValue,
};

/** An approval's own operation as navigation shows it, and the project it shows it on. */
export interface ProposalOperation {
  readonly operation: HqOperation;
  readonly projectId: string;
}

/**
 * The operation HQ names as one proposal's own (its decision's `operation`), wherever navigation
 * shows it: a card's Continue and End act on this, never on what its project happens to show.
 */
export const proposalOperationOf: Projection<
  { readonly orgId: string; readonly operationId: string },
  ProposalOperation | undefined
> = {
  name: "proposalOperationOf",
  keyOf: ({ orgId, operationId }) => `${orgId}/${operationId}`,
  derive: (read, { orgId, operationId }) => {
    for (const projectId of read.members(placementsScope(orgId)).ids) {
      const placement = read.fact("placement", projectId);
      if (placement.kind !== "known") continue;
      const operation = placement.value.operation;
      if (operation?.kind === PROPOSAL_EFFECT && operation.id === operationId)
        return { operation, projectId };
    }
    return undefined;
  },
  equals: sameValue,
};

/**
 * How the effect's operation stands, as one value that changes with each move of it in navigation
 * (shown, its phase, its failure, gone): what a card reads HQ's decision again on.
 */
export const proposalEffectMoved = (operation: HqOperation | undefined): string =>
  operation === undefined
    ? "none"
    : `${operation.id}:${operation.phase}:${operation.failure?.code ?? ""}`;
