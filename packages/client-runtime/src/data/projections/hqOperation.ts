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
import { waitingWords, type WaitingWords } from "./operationFailure.ts";

/** HQ's offer of an operation's Continue to the person reading (spec "Operation offers"). */
const CONTINUE = "continue";

/**
 * HQ's offer of an application's operation's end to an Owner or an Admin, while its maker cannot
 * continue it (spec "Operation offers").
 */
const END = "end";

/** HQ offers the reader a new start after an operation ended failed. */
const AGAIN = "again";

export type HqOperationStanding =
  /** None of this kind is shown: nothing runs, or the newest one ended done. */
  | { readonly kind: "none" }
  /** HQ runs it: the target offers nothing that would start it again. */
  | { readonly kind: "going"; readonly id: string }
  /**
   * It stopped open and HQ names its maker: it waits for their Continue of `id`
   * (`continueBy`, a Zerops user id); `yours` where HQ offers the person reading that Continue,
   * `endable` where HQ offers them its end, beside that Continue at an unknown outcome; its
   * `WaitingWords` say that Continue's button and why it waits.
   */
  | (WaitingWords & {
      readonly kind: "waiting";
      readonly id: string;
      readonly continueBy: string;
      readonly yours: boolean;
      readonly endable?: true;
    })
  /**
   * It ended with a failure: its target stands, and `again` is present where HQ offers a new start.
   * The failure is HQ's as sent, including who stopped it and Zerops' answer where it refused.
   */
  | {
      readonly kind: "failed";
      readonly id: string;
      readonly failure: HqOperationFailure;
      readonly again?: true;
    }
  /**
   * It ended at a decision its target's person has not made (`needs`: a Put it live's
   * `release_review`): nothing runs, and the decision is offered.
   */
  | { readonly kind: "needs"; readonly needs: string };

const NONE: HqOperationStanding = { kind: "none" };

/** How the operation of `kind` that HQ shows on a target stands, for the person HQ read it for. */
export function hqOperationOf(
  operation: HqOperation | undefined,
  kind: string,
): HqOperationStanding {
  if (operation?.kind !== kind) return NONE;
  if (operation.failure === undefined)
    return operation.needs === undefined
      ? { kind: "going", id: operation.id }
      : { kind: "needs", needs: operation.needs };
  // HQ names its maker exactly while the operation waits for them, whatever it waits on, and
  // offers its Continue only to that maker while the right it decides again is theirs.
  if (operation.continueBy !== undefined)
    return {
      kind: "waiting",
      id: operation.id,
      continueBy: operation.continueBy,
      yours: operation.offers?.includes(CONTINUE) === true,
      ...waitingWords(operation.failure.code),
      ...(operation.offers?.includes(END) === true ? { endable: true as const } : {}),
    };
  if (operation.offers?.includes(AGAIN) === true)
    return { kind: "failed", id: operation.id, failure: operation.failure, again: true };
  return { kind: "failed", id: operation.id, failure: operation.failure };
}
