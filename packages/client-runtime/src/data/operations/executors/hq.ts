/**
 * HQ as the owner of the operations it executes: each kind's write through the organization's
 * official HQ, its answer the receipt. A write whose answer was lost — HQ's client could not read
 * back whether it was made — may have been made: uncertain, never sent again blindly. A refusal
 * keeps what HQ said; HQ unreachable took nothing.
 *
 * @module data/operations/executors/hq
 */
import * as Effect from "effect/Effect";

import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import { HQ_NOT_OPEN } from "../../../zerops/hq/refusals.ts";
import { discussionId } from "../../families/hqDiscussion.ts";
import type { OperationIntent, OperationReceipt } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor, UncertainAcceptance } from "../coordinator.ts";
import { FLOW_WRITE_KINDS, type FlowWriteIntent } from "../flowWrites.ts";
import { flowWrite, type FlowWrites } from "./hqFlow.ts";

/** The writes HQ executes, as its client sends them. */
export type HqWrites = Pick<HqApi, "commentOnChange"> & FlowWrites;

const FLOW_KINDS: ReadonlySet<string> = new Set(FLOW_WRITE_KINDS.map(({ kind }) => kind));

function faultOf(cause: unknown): StreamFault | UncertainAcceptance {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!(cause instanceof HqError) || cause.kind === "uncertain")
    return { outcome: "uncertain-acceptance", message };
  if (cause.kind === "refused") return { outcome: "definitive-refusal", message };
  return { outcome: "transient", message };
}

const accepted = (
  requestId: string,
  operationId: string,
  affected: OperationReceipt["affected"],
): OperationReceipt => ({
  requestId,
  operationId,
  executor: "hq",
  affected,
  handles: [operationId],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
});

export function makeHqExecutor(ports: {
  /** The organization's official HQ, once known; `null` while none is. */
  readonly apiOf: (orgId: string) => HqWrites | null;
}): OperationExecutor {
  return {
    submit: (requestId, intent: OperationIntent) =>
      Effect.gen(function* () {
        if (FLOW_KINDS.has(intent.kind)) {
          const flow = intent as FlowWriteIntent;
          const api = ports.apiOf(flow.orgId);
          if (api === null)
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: HQ_NOT_OPEN,
            });
          return yield* flowWrite(requestId, api, flow, (call) =>
            Effect.tryPromise({ try: call, catch: faultOf }),
          );
        }
        if (intent.kind !== "change-comment")
          return yield* Effect.die(new Error(`HQ executes no ${intent.kind}.`));
        const api = ports.apiOf(intent.orgId);
        // No HQ to send it to: nothing was sent, and nothing will be until one is named.
        if (api === null)
          return yield* Effect.fail<StreamFault>({
            outcome: "definitive-refusal",
            message: HQ_NOT_OPEN,
          });
        const said = yield* Effect.tryPromise({
          try: () => api.commentOnChange(intent.link, intent.body),
          catch: faultOf,
        });
        return accepted(requestId, said.id, [
          { family: "hqDiscussion", id: discussionId(intent.link) },
        ]);
      }),
  };
}
