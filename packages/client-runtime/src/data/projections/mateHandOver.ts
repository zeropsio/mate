/**
 * How HQ's hand-over of a Mate stands: the one answer its Mate's row, its card and its menu render.
 * HQ runs it as its operation `mate_handover` (`mate-hq spec/protocol.md`, _Hand-over_) and shows it
 * on the project in navigation, to every device, while it runs and once it failed, until the next
 * start on the project. Its Continue is offered to any Owner or Admin HQ allows it now, not only its
 * maker; after `token_delete_refused` an Owner alone (`ownerOnly`).
 *
 * Pure: no network (rule R1).
 *
 * @module data/projections/mateHandOver
 */
import type { HqOperation } from "../../zerops/hq/client.ts";
import { hqOperationOf, type HqOperationStanding } from "./hqOperation.ts";

/** HQ's kind of a Mate's hand-over. */
const MATE_HANDOVER = "mate_handover";

/** Zerops let the hand-over's token revoke no Owner's key: only an Owner's Continue finishes it. */
const TOKEN_DELETE_REFUSED = "token_delete_refused";

export type MateHandOver = HqOperationStanding & {
  /** It waits for an organization Owner, whom HQ alone lets revoke the key it replaced. */
  readonly ownerOnly?: true;
};

/** How the hand-over HQ shows on a project stands, for the person HQ read it for. */
export function mateHandOverOf(project: {
  readonly hq?: { readonly operation?: HqOperation | undefined } | undefined;
}): MateHandOver {
  const operation = project.hq?.operation;
  const standing = hqOperationOf(operation, MATE_HANDOVER);
  return standing.kind === "waiting" && operation?.failure?.code === TOKEN_DELETE_REFUSED
    ? { ...standing, ownerOnly: true }
    : standing;
}
