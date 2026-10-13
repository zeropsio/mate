import { ProviderInstanceId, ThreadId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";

import { makeScriptedProvider } from "./scriptedProviderDriver.ts";

const threadId = ThreadId.make("thread-1");

const started = Effect.gen(function* () {
  const scripted = yield* makeScriptedProvider();
  const instance = yield* scripted.driver.create({
    instanceId: ProviderInstanceId.make("opencode"),
    displayName: "OpenCode",
    environment: [],
    enabled: true,
    config: {},
  } as never);
  yield* instance.adapter.startSession({
    threadId,
    provider: instance.driverKind,
    cwd: "/workspace",
    runtimeMode: "full-access",
  } as never);
  return { scripted, adapter: instance.adapter };
});

const eventsOf = (stream: Stream.Stream<ProviderRuntimeEvent>, until: (type: string) => boolean) =>
  stream.pipe(
    Stream.takeUntil((event) => until(event.type)),
    Stream.runCollect,
    Effect.map((events) =>
      [...events].map((event) => ({ type: event.type, payload: event.payload })),
    ),
  );

describe("scripted provider", () => {
  it.effect("a scripted turn reaches the provider with its exact text and replies once", () =>
    Effect.gen(function* () {
      const { scripted, adapter } = yield* started;
      yield* scripted.turn([{ kind: "say", text: "Hello back" }]);
      yield* adapter.sendTurn({ threadId, input: "Hello, Mate" });

      expect((yield* scripted.received).input.input).toBe("Hello, Mate");
      expect(yield* eventsOf(adapter.streamEvents, (type) => type === "turn.completed")).toEqual([
        { type: "session.started", payload: {} },
        { type: "turn.started", payload: {} },
        {
          type: "item.started",
          payload: { itemType: "assistant_message", status: "inProgress" },
        },
        { type: "content.delta", payload: { streamKind: "assistant_text", delta: "Hello back" } },
        {
          type: "item.completed",
          payload: { itemType: "assistant_message", status: "completed" },
        },
        { type: "turn.completed", payload: { state: "completed" } },
      ]);
    }),
  );

  it.effect("a scripted question holds the turn until it is answered", () =>
    Effect.gen(function* () {
      const { scripted, adapter } = yield* started;
      yield* scripted.turn([
        { kind: "ask", question: "Which?" },
        { kind: "say", text: "Thanks" },
      ]);
      yield* adapter.sendTurn({ threadId, input: "Go" });
      const asked = yield* eventsOf(
        adapter.streamEvents,
        (type) => type === "user-input.requested",
      );
      expect(asked.at(-1)?.type).toBe("user-input.requested");

      yield* adapter.respondToUserInput(threadId, "scripted-request-1" as never, { "0": "That" });
      const rest = yield* eventsOf(adapter.streamEvents, (type) => type === "turn.completed");
      expect(rest.map(({ type }) => type)).toEqual([
        "user-input.resolved",
        "item.started",
        "content.delta",
        "item.completed",
        "turn.completed",
      ]);
      expect(scripted.answers).toEqual([
        { requestId: "scripted-request-1", answer: { "0": "That" } },
      ]);
    }),
  );

  it.effect("a usage limit ends the turn failed as a usage limit", () =>
    Effect.gen(function* () {
      const { scripted, adapter } = yield* started;
      yield* scripted.turn([{ kind: "limit", message: "Usage limit reached" }]);
      yield* adapter.sendTurn({ threadId, input: "Go" });
      const events = yield* eventsOf(adapter.streamEvents, (type) => type === "turn.completed");
      expect(events.slice(-2)).toEqual([
        {
          type: "runtime.error",
          payload: { message: "Usage limit reached", class: "usage_limit" },
        },
        {
          type: "turn.completed",
          payload: {
            state: "failed",
            errorMessage: "Usage limit reached",
            terminalReason: "usage_limit",
          },
        },
      ]);
    }),
  );

  it.effect("a send with no scripted turn fails instead of inventing a reply", () =>
    Effect.gen(function* () {
      const { adapter } = yield* started;
      const error = yield* Effect.flip(adapter.sendTurn({ threadId, input: "Unscripted" }));
      expect(error._tag).toBe("ProviderAdapterValidationError");
    }),
  );
});

describe("scripted canonical vocabulary", () => {
  it.effect("canonical item events retain correlated ids and overlapping call facts", () =>
    Effect.gen(function* () {
      const { scripted, adapter } = yield* started;
      yield* scripted.turn([
        {
          kind: "event",
          event: {
            type: "item.started",
            itemId: "call-a" as never,
            payload: {
              itemType: "command_execution",
              data: { toolName: "Bash", input: { command: "printf first-proof" } },
            },
          },
        },
        {
          kind: "event",
          event: {
            type: "item.started",
            itemId: "call-b" as never,
            payload: {
              itemType: "command_execution",
              data: { toolName: "Bash", input: { command: "printf second-proof" } },
            },
          },
        },
        {
          kind: "event",
          event: {
            type: "item.completed",
            itemId: "call-b" as never,
            payload: {
              itemType: "command_execution",
              status: "completed",
              data: { toolName: "Bash", result: "Second result" },
            },
          },
        },
        {
          kind: "event",
          event: {
            type: "item.completed",
            itemId: "call-a" as never,
            payload: {
              itemType: "command_execution",
              status: "completed",
              data: { toolName: "Bash", result: "First result" },
            },
          },
        },
      ]);
      yield* adapter.sendTurn({ threadId, input: "Inspect both" });
      const events = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((e) => e.type === "turn.completed"),
        Stream.runCollect,
      );
      expect(
        [...events].filter((e) => e.type.startsWith("item.")).map((e) => [e.type, e.itemId]),
      ).toEqual([
        ["item.started", "call-a"],
        ["item.started", "call-b"],
        ["item.completed", "call-b"],
        ["item.completed", "call-a"],
      ]);
    }),
  );
});
