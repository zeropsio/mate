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
import type { OperationIntent, OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OperationExecutor, UncertainAcceptance } from "../coordinator.ts";
import {
  changeHandle,
  environmentHandle,
  FLOW_WRITE_KINDS,
  type FlowWriteIntent,
} from "../flowWrites.ts";

/** The flow's writes HQ executes, as its client sends them. */
type FlowWrites = Pick<
  HqApi,
  "release" | "rollback" | "redeploy" | "addService" | "mergeChange" | "closeChange"
>;

type Write = <A>(call: () => Promise<A>) => Effect.Effect<A, StreamFault | UncertainAcceptance>;

const receipt = (
  requestId: string,
  handle: string,
  result: OperationResult | undefined,
  outcome: OperationReceipt["outcome"],
): OperationReceipt => ({
  requestId,
  operationId: handle,
  executor: "hq",
  affected: [],
  handles: [handle],
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
  outcome,
});
const PENDING: OperationReceipt["outcome"] = { kind: "pending" };

function flowWrite(
  requestId: string,
  api: FlowWrites,
  intent: FlowWriteIntent,
  write: Write,
): Effect.Effect<OperationReceipt, StreamFault | UncertainAcceptance> {
  switch (intent.kind) {
    case "release":
      return Effect.map(
        write(() =>
          api.release(intent.appId, {
            tag: intent.tag,
            groupHead: intent.groupHead,
            entries: intent.entries,
          }),
        ),
        ({ made, deploys }) => receipt(requestId, made.tag, { tag: made.tag, deploys }, PENDING),
      );
    case "roll-back":
      return Effect.map(
        write(() => api.rollback(intent.appId, intent.tag, { groupHead: intent.groupHead })),
        ({ made, deploys }) => receipt(requestId, made.tag, { tag: made.tag, deploys }, PENDING),
      );
    case "redeploy":
      return Effect.map(
        write(() =>
          api.redeploy(intent.appId, intent.environment, {
            service: intent.service,
            sha: intent.sha,
          }),
        ),
        (deploys) => receipt(requestId, environmentHandle(intent), { deploys }, PENDING),
      );
    case "add-service":
      return Effect.map(
        write(() => api.addService(intent.appId, intent.environment, intent.service)),
        (deploys) =>
          receipt(
            requestId,
            environmentHandle(intent),
            { deploys },
            { kind: "succeeded", evidence: "HQ answered the write." },
          ),
      );
    case "merge-change":
      return Effect.map(
        write(() => api.mergeChange(intent.link, intent.expectedHead)),
        ({ deploys }) => receipt(requestId, changeHandle(intent.link), { deploys }, PENDING),
      );
    case "close-change":
      return Effect.map(
        write(() => api.closeChange(intent.link)),
        () => receipt(requestId, changeHandle(intent.link), undefined, PENDING),
      );
  }
}

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
