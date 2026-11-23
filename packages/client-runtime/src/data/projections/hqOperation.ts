/**
 * How an operation HQ runs on the person's token stands (`mate-hq spec/protocol.md` S13c): the one
 * answer every surface of a deletion or a removal renders, from the operation HQ's navigation shows
 * on its target, to every device and every person who reads that target.
 *
 * Pure: no network (rule R1).
 *
 * @module data/projections/hqOperation
 */
import type { HqOperation } from "../../zerops/hq/client.ts";
import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";

/** HQ's failure code of an operation whose token was refused or lapsed: it waits for its maker. */
const TOKEN_EXPIRED = "token_expired";

/** HQ's offer of an operation's Continue to the person reading (spec "Operation offers"). */
const CONTINUE = "continue";

/**
 * HQ's offer of an application's operation's end to an Owner or an Admin, while its maker cannot
 * continue it (spec "Operation offers").
 */
const END = "end";

export type HqOperationStanding =
  /** None of this kind is shown: nothing runs, or the newest one ended done. */
  | { readonly kind: "none" }
  /** HQ runs it: the target offers nothing that would start it again. */
  | { readonly kind: "going" }
  /**
   * It stopped open because its maker's token lapsed: it waits for their Continue of `id`
   * (`continueBy`, a Zerops user id); `yours` where HQ offers the person reading that Continue,
   * `endable` where HQ offers them its end, its maker being unable to continue it.
   */
  | {
      readonly kind: "waiting";
      readonly id: string;
      readonly continueBy: string;
      readonly yours: boolean;
      readonly endable?: true;
    }
  /**
   * It ended with a failure: its target stands, and is offered again. The failure is HQ's as sent,
   * including who stopped it and Zerops' answer where it refused.
   */
  | { readonly kind: "failed"; readonly failure: HqOperationFailure }
  /**
   * It ended at a decision its target's person has not made (`needs`: a Put it live's
   * `release_review`): nothing runs, and the decision is offered.
   */
  | { readonly kind: "needs"; readonly needs: string };

const NONE: HqOperationStanding = { kind: "none" };
const GOING: HqOperationStanding = { kind: "going" };

/** How the operation of `kind` that HQ shows on a target stands, for the person HQ read it for. */
export function hqOperationOf(
  operation: HqOperation | undefined,
  kind: string,
): HqOperationStanding {
  if (operation?.kind !== kind) return NONE;
  if (operation.failure === undefined)
    return operation.needs === undefined ? GOING : { kind: "needs", needs: operation.needs };
  // HQ names its maker only while it stands open waiting for their fresh token, and offers its
  // Continue only to that maker while the right it decides again is theirs.
  if (operation.failure.code === TOKEN_EXPIRED && operation.continueBy !== undefined)
    return {
      kind: "waiting",
      id: operation.id,
      continueBy: operation.continueBy,
      yours: operation.offers?.includes(CONTINUE) === true,
      ...(operation.offers?.includes(END) === true ? { endable: true as const } : {}),
    };
  return { kind: "failed", failure: operation.failure };
}
