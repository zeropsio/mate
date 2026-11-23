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
