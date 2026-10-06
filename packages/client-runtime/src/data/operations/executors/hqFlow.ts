/**
 * A flow's writes as HQ executes them (`flowWrites.ts`): each sent through the organization's
 * official HQ as the person, HQ's answer its receipt — accepted with what HQ made, and ended by
 * HQ's records showing it; an added service, by HQ's answer itself.
 *
 * @module data/operations/executors/hqFlow
 */
import * as Effect from "effect/Effect";

import type { HqApi } from "../../../zerops/hq/client.ts";
import type { OperationReceipt, OperationResult } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { UncertainAcceptance } from "../coordinator.ts";
import { changeHandle, environmentHandle, type FlowWriteIntent } from "../flowWrites.ts";

/** The flow's writes HQ executes, as its client sends them. */
export type FlowWrites = Pick<
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

export function flowWrite(
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
