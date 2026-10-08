/**
 * What a person does to an engine conversation — send, stop, answer, dismiss, steer, set its
 * model, runtime mode or agent — as operations the Mate owns. The operation's request id is the engine's command id: the engine keeps one receipt
 * per command, so a lost answer is asked of it by that id and a repeat is applied once. A send,
 * an answer, a dismissal and a steer settle when the engine accepts them (delivery is then the
 * item's own fact); a stop settles when its run's record ends.
 *
 * @module data/operations/mateEngine
 */
import type { ProviderOptionSelection, RuntimeMode } from "@t3tools/contracts";

import { engineFactId } from "../families/mateEngine.ts";
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { OperationKind } from "./kind.ts";

export interface EngineOperationTarget {
  readonly environmentId: string;
  readonly conversationId: string;
}

/** What the engine answered an accepted command with: where it landed in the conversation. */
export interface EngineAcceptance {
  readonly seq: number;
  readonly runId?: string;
  readonly itemId?: string;
  readonly requestId?: string;
}

declare module "../model.ts" {
  interface OperationIntents {
    /** The person's words; pictures travel by reference and are counted, never retained here. */
    readonly "mate-engine-send": EngineOperationTarget & {
      readonly text: string;
      readonly pictures: number;
    };
    readonly "mate-engine-stop": EngineOperationTarget & { readonly runId: string | null };
    /** Only the answer's summary is retained: what the record shows, never a secret's value. */
    readonly "mate-engine-answer": EngineOperationTarget & {
      readonly requestId: string;
      readonly summary: string;
    };
    /** A question closed unanswered. */
    readonly "mate-engine-dismiss": EngineOperationTarget & { readonly requestId: string };
    readonly "mate-engine-steer": EngineOperationTarget & {
      readonly runId: string;
      readonly text: string;
    };
    readonly "mate-engine-switch-model": EngineOperationTarget & {
      readonly model: string;
      readonly options?: ReadonlyArray<ProviderOptionSelection>;
    };
    readonly "mate-engine-set-runtime-mode": EngineOperationTarget & {
      readonly runtimeMode: RuntimeMode;
    };
    readonly "mate-engine-assign-agent": EngineOperationTarget & { readonly instanceId: string };
  }
  interface OperationResults {
    readonly "mate-engine-send": EngineAcceptance;
    readonly "mate-engine-stop": EngineAcceptance;
    readonly "mate-engine-answer": EngineAcceptance;
    readonly "mate-engine-dismiss": EngineAcceptance;
    readonly "mate-engine-steer": EngineAcceptance;
    readonly "mate-engine-switch-model": EngineAcceptance;
    readonly "mate-engine-set-runtime-mode": EngineAcceptance;
    readonly "mate-engine-assign-agent": EngineAcceptance;
  }
}

const acceptance = (receipt: OperationReceipt): EngineAcceptance | null =>
  receipt.acceptance.kind === "accepted" && receipt.acceptance.result !== undefined
    ? (receipt.acceptance.result as EngineAcceptance)
    : null;

/** Whether the item the engine said it made is held now. */
const itemHeld = (
  read: ProjectionReads,
  intent: EngineOperationTarget,
  receipt: OperationReceipt,
) => {
  const itemId = acceptance(receipt)?.itemId;
  return (
    itemId !== undefined &&
    read.fact("mateEngineItem", engineFactId(intent.environmentId, itemId)).kind === "known"
  );
};

export const mateEngineSend: OperationKind<"mate-engine-send"> = {
  kind: "mate-engine-send",
  executor: "mate",
  reflected: itemHeld,
};

export const mateEngineSteer: OperationKind<"mate-engine-steer"> = {
  kind: "mate-engine-steer",
  executor: "mate",
  reflected: itemHeld,
};

/** Whether the request an answer or a dismissal closes is held closed now. */
const requestClosed = (
  read: ProjectionReads,
  intent: EngineOperationTarget & { readonly requestId: string },
) => {
  const request = read.fact(
    "mateEngineRequest",
    engineFactId(intent.environmentId, intent.requestId),
  );
  return request.kind === "known" && request.value.state !== "open";
};

export const mateEngineAnswer: OperationKind<"mate-engine-answer"> = {
  kind: "mate-engine-answer",
  executor: "mate",
  reflected: requestClosed,
};

export const mateEngineDismiss: OperationKind<"mate-engine-dismiss"> = {
  kind: "mate-engine-dismiss",
  executor: "mate",
  reflected: requestClosed,
};

const stoppedRun = (
  read: ProjectionReads,
  intent: EngineOperationTarget & { readonly runId: string | null },
  receipt: OperationReceipt,
) => {
  const runId = intent.runId ?? acceptance(receipt)?.runId;
  if (runId === undefined) return null;
  const run = read.fact("mateEngineRun", engineFactId(intent.environmentId, runId));
  return run.kind === "known" ? run.value : null;
};

export const mateEngineStop: OperationKind<"mate-engine-stop"> = {
  kind: "mate-engine-stop",
  executor: "mate",
  reflected: (read, intent, receipt) => {
    const run = stoppedRun(read, intent, receipt);
    return run !== null && (run.stopAsked !== null || run.state === "ended");
  },
  settledBy: (read, intent, receipt) => {
    if (receipt.acceptance.kind !== "accepted") return null;
    const run = stoppedRun(read, intent, receipt);
    if (run !== null) return run.state === "ended" ? { kind: "succeeded" } : null;
    // Not open here (a Stop from the menu): the conversation's row says when its run is over.
    const runId = intent.runId ?? acceptance(receipt)?.runId ?? null;
    const row = read.fact(
      "mateEngineRow",
      engineFactId(intent.environmentId, intent.conversationId),
    );
    if (row.kind !== "known" || runId === null) return null;
    return row.value.activeRunId !== runId ? { kind: "succeeded" } : null;
  },
};

/** Whether this account follows the conversation a Stop asked: its run, or its menu row. */
export const stopObservable = (
  read: ProjectionReads,
  intent: EngineOperationTarget & { readonly runId: string | null },
  receipt: OperationReceipt,
) =>
  stoppedRun(read, intent, receipt) !== null ||
  read.fact("mateEngineRow", engineFactId(intent.environmentId, intent.conversationId)).kind ===
    "known";

const headerOf = (read: ProjectionReads, intent: EngineOperationTarget) => {
  const conversation = read.fact(
    "mateEngineConversation",
    engineFactId(intent.environmentId, intent.conversationId),
  );
  return conversation.kind === "known" ? conversation.value.header : null;
};

/** A model switch shows once the conversation's header names the model and its options. */
export const mateEngineSwitchModel: OperationKind<"mate-engine-switch-model"> = {
  kind: "mate-engine-switch-model",
  executor: "mate",
  reflected: (read, intent) => {
    const header = headerOf(read, intent);
    return (
      header !== null &&
      header.model === intent.model &&
      (intent.options === undefined ||
        JSON.stringify(header.agent?.options ?? []) === JSON.stringify(intent.options))
    );
  },
};

/** A runtime mode shows once the conversation's header names it. */
export const mateEngineSetRuntimeMode: OperationKind<"mate-engine-set-runtime-mode"> = {
  kind: "mate-engine-set-runtime-mode",
  executor: "mate",
  reflected: (read, intent) => headerOf(read, intent)?.runtimeMode === intent.runtimeMode,
};

/** An agent pick shows once the conversation's header names its instance. */
export const mateEngineAssignAgent: OperationKind<"mate-engine-assign-agent"> = {
  kind: "mate-engine-assign-agent",
  executor: "mate",
  reflected: (read, intent) => headerOf(read, intent)?.agent?.instanceId === intent.instanceId,
};

export const MATE_ENGINE_KINDS = [
  mateEngineSend,
  mateEngineStop,
  mateEngineAnswer,
  mateEngineDismiss,
  mateEngineSteer,
  mateEngineSwitchModel,
  mateEngineSetRuntimeMode,
  mateEngineAssignAgent,
] as const;
