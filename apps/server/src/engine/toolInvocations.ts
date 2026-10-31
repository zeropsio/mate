// @effect-diagnostics preferSchemaOverJson:off -- hashing canonical JSON bytes, not decoding a contract.
/** Durable native-call capture and authority binding; no provider I/O before capture. */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { CommandId, RunId, type CommandResult, type ToolInvocationScope } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type { ToolInvocation } from "../spi/toolInvocation.ts";
import type { Envelope } from "./domain/command.ts";
import { conversationOfThread } from "./pump/TurnPump.ts";
import type { EngineStoreShape } from "./store/EngineStore.ts";
import { EngineStore } from "./store/EngineStore.ts";
import { Conversations } from "./Conversations.ts";

export class ToolInvocationUnavailable extends Data.TaggedError("ToolInvocationUnavailable")<{
  readonly reason: string;
}> {}

const hash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)));

/** JSON object key ordering is immaterial; array order and all scalar values are not. */
const canonical = (input: unknown): string => {
  if (input === null || typeof input === "string" || typeof input === "boolean")
    return JSON.stringify(input);
  if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonical).join(",")}]`;
  if (
    typeof input === "object" &&
    input !== null &&
    Object.getPrototypeOf(input) === Object.prototype
  ) {
    return `{${Object.entries(input)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
      .join(",")}}`;
  }
  throw new Error("tool arguments must be finite JSON");
};

export const makeToolInvocations = <E>(
  store: EngineStoreShape,
  tell: (envelope: Envelope) => Effect.Effect<CommandResult, E>,
) => {
  const resolve = Effect.fn("toolInvocations.resolve")(function* (
    input: unknown,
    invocation: ToolInvocation,
    preparedOnly: boolean,
  ) {
    const conversation = conversationOfThread(invocation.threadId);
    if (conversation === undefined)
      return yield* new ToolInvocationUnavailable({ reason: "unknown engine owner" });
    const identity = invocation.identity;
    const id = hash(
      JSON.stringify([
        identity.driver,
        identity.instanceId,
        identity.sessionId,
        identity.messageId,
        identity.callId,
      ]),
    );
    const inputHash = yield* Effect.try({
      try: () => hash(canonical(input)),
      catch: () => new ToolInvocationUnavailable({ reason: "invalid tool arguments" }),
    });
    const captureId = CommandId.make(`tool:capture:${id}`);
    const bindId = CommandId.make(`tool:bind:${id}`);
    const command = (commandId: CommandId, payload: Envelope["command"]): Envelope => ({
      conversationId: conversation,
      commandId,
      principal: { kind: "engine" },
      command: payload,
    });
    if (!preparedOnly) {
      const captured = yield* tell(
        command(captureId, { _tag: "CaptureToolInvocation", invocationId: id, inputHash }),
      );
      if (captured._tag !== "Accepted")
        return yield* new ToolInvocationUnavailable({ reason: "capture refused" });
    }
    const capture = (yield* store.commandEvents(conversation, captureId)).find(
      (event) => event._tag === "ToolInvocationCaptured",
    );
    if (capture?._tag !== "ToolInvocationCaptured" || capture.inputHash !== inputHash)
      return yield* new ToolInvocationUnavailable({ reason: "native call arguments conflict" });
    const kept = (yield* store.commandEvents(conversation, bindId)).find(
      (event) => event._tag === "ToolInvocationBound",
    );
    let scope: ToolInvocationScope | undefined;
    if (kept?._tag === "ToolInvocationBound") {
      scope = kept.scope;
    } else {
      if (preparedOnly)
        return yield* new ToolInvocationUnavailable({
          reason: "native invocation has not been prepared",
        });
      // This callback may await a native SDK. Its eventual answer never authorizes from current state.
      const runId = yield* invocation.resolveTurn();
      const state = yield* store.loadAt(conversation, capture.seq);
      const run = runId === undefined ? undefined : state.runs[RunId.make(runId)];
      if (run?.principal.kind === "person") scope = { kind: "manual" };
      if (run?.principal.kind === "task" && run.taskAssignment !== undefined) {
        const held = state.taskAssignments[run.principal.taskId];
        if (held?.state === "active" && held.assignment === run.taskAssignment) {
          scope = { kind: "task", taskId: run.principal.taskId, assignment: run.taskAssignment };
        }
      }
      if (scope === undefined)
        return yield* new ToolInvocationUnavailable({
          reason: "native parent has no proved authority at capture",
        });
      const result = yield* tell(
        command(bindId, {
          _tag: "BindToolInvocation",
          invocationId: id,
          capturedSeq: capture.seq,
          scope,
        }),
      );
      if (result._tag !== "Accepted")
        return yield* new ToolInvocationUnavailable({ reason: "binding refused" });
      // A concurrent retry may have committed first: its immutable result is authoritative.
      const bound = (yield* store.commandEvents(conversation, bindId)).find(
        (event) => event._tag === "ToolInvocationBound",
      );
      if (bound?._tag !== "ToolInvocationBound")
        return yield* new ToolInvocationUnavailable({ reason: "binding not recorded" });
      scope = bound.scope;
    }
    return { v: 1 as const, id, scope };
  });
  return {
    bind: (input: unknown, invocation: ToolInvocation) => resolve(input, invocation, false),
    recorded: (input: unknown, invocation: ToolInvocation) => resolve(input, invocation, true),
  };
};

export class EngineToolInvocations extends Context.Service<
  EngineToolInvocations,
  ReturnType<
    typeof makeToolInvocations<
      | import("./store/EngineStore.ts").EngineStoreError
      | import("./ConversationActor.ts").StepFailure
    >
  >
>()("t3/engine/toolInvocations/EngineToolInvocations") {
  static readonly layer = Layer.effect(
    EngineToolInvocations,
    Effect.gen(function* () {
      const store = yield* EngineStore;
      const conversations = yield* Conversations;
      return makeToolInvocations(store, conversations.tell);
    }),
  );
}
