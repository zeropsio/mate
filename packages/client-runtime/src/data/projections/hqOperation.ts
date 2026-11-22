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

/** HQ's failure code of an operation whose token was refused or lapsed: it waits for its maker. */
const TOKEN_EXPIRED = "token_expired";

export type HqOperationStanding =
  /** None of this kind is shown: nothing runs, or the newest one ended done. */
  | { readonly kind: "none" }
  /** HQ runs it: the target offers nothing that would start it again. */
  | { readonly kind: "going" }
  /**
   * It stopped open because its maker's token lapsed: it waits for their Continue of `id`
   * (`continueBy`, a Zerops user id); `yours` where that is the person reading.
   */
  | {
      readonly kind: "waiting";
      readonly id: string;
      readonly continueBy: string;
      readonly yours: boolean;
    }
  /**
   * It ended with a failure: its target stands, and is offered again. `code` is the one it shows:
   * Zerops' own where Zerops refused, else HQ's.
   */
  | { readonly kind: "failed"; readonly code: string };

const NONE: HqOperationStanding = { kind: "none" };
const GOING: HqOperationStanding = { kind: "going" };

/** How the operation of `kind` that HQ shows on a target stands, for the person `viewer`. */
export function hqOperationOf(
  operation: HqOperation | undefined,
  kind: string,
  viewer: string | undefined,
): HqOperationStanding {
  if (operation?.kind !== kind) return NONE;
  if (operation.failure === undefined) return GOING;
  // HQ names its maker only while it stands open waiting for their fresh token.
  if (operation.failure.code === TOKEN_EXPIRED && operation.continueBy !== undefined)
    return {
      kind: "waiting",
      id: operation.id,
      continueBy: operation.continueBy,
      yours: operation.continueBy === viewer,
    };
  return { kind: "failed", code: operation.failure.zeropsCode ?? operation.failure.code };
}
