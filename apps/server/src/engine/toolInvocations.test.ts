import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  ConversationId,
  RunId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { makeToolInvocations } from "./toolInvocations.ts";
import { makeEngineStore, EngineStoreError } from "./store/EngineStore.ts";
import { decide } from "./domain/decide.ts";
import { initialState } from "./domain/state.ts";
import { conversation, drive, envelope, r, sqliteWithEngineTables } from "./testing/fixtures.ts";

const identity = {
  driver: ProviderDriverKind.make("opencode"),
  instanceId: ProviderInstanceId.make("opencode"),
  sessionId: "native-session",
  messageId: "actual-assistant",
  callId: "actual-tool-call",
};

describe("native tool invocation provenance", () => {
  it.layer(sqliteWithEngineTables)("durable capture", (it) => {
    it.effect(
      "a delayed parent lookup binds the grant at entry and a retry keeps that original scope",
      () =>
        Effect.gen(function* () {
          const store = yield* makeEngineStore({ snapshotEvery: 1 });
          const first = envelope(
            { _tag: "Send", text: "work", taskId: "task", taskAssignment: "1" },
            {
              by: { kind: "task", taskId: "task", assignment: "1" },
            },
          );
          yield* drive(store, initialState(conversation), [first]);
          const tell = Effect.fnUntraced(function* (input: Parameters<typeof decide>[1]) {
            const state = yield* store.load(input.conversationId);
            return (yield* store.commit({
              state,
              envelope: input,
              decision: decide(state, input, 100),
              now: 100,
            })).result;
          });
          const invocations = makeToolInvocations(store, tell);
          let lookups = 0;
          const input = { action: "open", repo: "repo" };
          const invocation = {
            identity,
            threadId: ThreadId.make(`${conversation}/s/1`),
            resolveTurn: () =>
              Effect.gen(function* () {
                lookups++;
                yield* tell(
                  envelope(
                    { _tag: "AdoptTaskAssignment", taskId: "task", assignment: "2", runId: r(1) },
                    {
                      by: { kind: "task", taskId: "task", assignment: "2" },
                    },
                  ),
                );
                return r(1);
              }).pipe(Effect.orDie),
          };
          expect((yield* Effect.result(invocations.recorded(input, invocation)))._tag).toBe(
            "Failure",
          );
          const bound = yield* invocations.bind(input, invocation);
          expect(bound.scope).toEqual({ kind: "task", taskId: "task", assignment: "1" });
          expect((yield* store.load(conversation)).runs[r(1)]?.taskAssignment).toBe("2");
          const reopened = makeToolInvocations(yield* makeEngineStore(), tell);
          expect(
            yield* reopened.recorded(input, {
              ...invocation,
              resolveTurn: () => Effect.die("approval cannot recapture a newer grant"),
            }),
          ).toEqual(bound);
          expect(
            yield* reopened.bind(input, {
              ...invocation,
              threadId: ThreadId.make(`${conversation}/s/99`),
              resolveTurn: () => Effect.die("a durable retry must not resolve a new parent"),
            }),
          ).toEqual(bound);
          expect(lookups).toBe(1);
          expect(
            (yield* reopened.bind(input, {
              ...invocation,
              identity: { ...identity, callId: "a-new-actual-call" },
              resolveTurn: () => Effect.succeed(r(1)),
            })).scope,
          ).toEqual({ kind: "task", taskId: "task", assignment: "2" });
          expect(
            (yield* Effect.result(reopened.bind({ ...input, repo: "different" }, invocation)))._tag,
          ).toBe("Failure");
        }),
    );
    it.effect("an unproved native parent never becomes manual permission", () =>
      Effect.gen(function* () {
        const conversation = ConversationId.make("unknown-native-parent");
        const store = yield* makeEngineStore();
        const tell = Effect.fnUntraced(function* (input: Parameters<typeof decide>[1]) {
          const state = yield* store.load(input.conversationId);
          return (yield* store.commit({
            state,
            envelope: input,
            decision: decide(state, input, 1),
            now: 1,
          })).result;
        });
        const result = yield* Effect.result(
          makeToolInvocations(store, tell).bind(
            {},
            {
              identity,
              threadId: ThreadId.make(`${conversation}/s/1`),
              resolveTurn: () => Effect.succeed<string | undefined>(undefined),
            },
          ),
        );
        expect(result._tag).toBe("Failure");
        // A later run cannot turn the old unproved invocation into a manual call.
        yield* tell(envelope({ _tag: "Send", text: "A later person request" }, { conversation }));
        expect(
          (yield* Effect.result(
            makeToolInvocations(store, tell).bind(
              {},
              {
                identity,
                threadId: ThreadId.make(`${conversation}/s/1`),
                resolveTurn: () => Effect.succeed(RunId.make(`${conversation}/r/1`)),
              },
            ),
          ))._tag,
        ).toBe("Failure");
      }),
    );
    it.effect(
      "a failed capture performs no parent lookup and leaves no accepted native invocation",
      () =>
        Effect.gen(function* () {
          const conversation = ConversationId.make("failed-native-capture");
          const store = yield* makeEngineStore({
            fault: (stage) =>
              stage === "projections"
                ? Effect.fail(
                    new EngineStoreError({
                      operation: "capture-fault",
                      cause: "actual transaction rollback",
                    }),
                  )
                : Effect.void,
          });
          const tell = Effect.fnUntraced(function* (input: Parameters<typeof decide>[1]) {
            const state = yield* store.load(input.conversationId);
            return (yield* store.commit({
              state,
              envelope: input,
              decision: decide(state, input, 1),
              now: 1,
            })).result;
          });
          let lookedUp = false;
          expect(
            (yield* Effect.result(
              makeToolInvocations(store, tell).bind(
                {},
                {
                  identity,
                  threadId: ThreadId.make(`${conversation}/s/1`),
                  resolveTurn: () =>
                    Effect.sync(() => {
                      lookedUp = true;
                      return r(1);
                    }),
                },
              ),
            ))._tag,
          ).toBe("Failure");
          expect(lookedUp).toBe(false);
          expect(yield* store.events(conversation, 0)).toEqual([]);
        }),
    );
    it.effect(
      "an actual person run remains explicitly manual without borrowing another task's grant",
      () =>
        Effect.gen(function* () {
          const conversation = ConversationId.make("manual-native-call");
          const store = yield* makeEngineStore();
          yield* drive(store, initialState(conversation), [
            envelope({ _tag: "Send", text: "Person work" }, { conversation }),
          ]);
          const tell = Effect.fnUntraced(function* (input: Parameters<typeof decide>[1]) {
            const state = yield* store.load(input.conversationId);
            return (yield* store.commit({
              state,
              envelope: input,
              decision: decide(state, input, 1),
              now: 1,
            })).result;
          });
          expect(
            (yield* makeToolInvocations(store, tell).bind(
              {},
              {
                identity,
                threadId: ThreadId.make(`${conversation}/s/1`),
                resolveTurn: () => Effect.succeed(RunId.make(`${conversation}/r/1`)),
              },
            )).scope,
          ).toEqual({ kind: "manual" });
        }),
    );
    it.effect(
      "a temporarily unavailable native parent can recover only at its original captured authority",
      () =>
        Effect.gen(function* () {
          const conversation = ConversationId.make("recover-native-parent");
          const runId = RunId.make(`${conversation}/r/1`);
          const store = yield* makeEngineStore({ snapshotEvery: 1 });
          yield* drive(store, initialState(conversation), [
            envelope(
              { _tag: "Send", text: "Original task", taskId: "kept", taskAssignment: "1" },
              { conversation, by: { kind: "task", taskId: "kept", assignment: "1" } },
            ),
          ]);
          const tell = Effect.fnUntraced(function* (input: Parameters<typeof decide>[1]) {
            const state = yield* store.load(input.conversationId);
            return (yield* store.commit({
              state,
              envelope: input,
              decision: decide(state, input, 1),
              now: 1,
            })).result;
          });
          const invoke = {
            identity,
            threadId: ThreadId.make(`${conversation}/s/1`),
            resolveTurn: () => Effect.succeed<string | undefined>(undefined),
          };
          expect(
            (yield* Effect.result(makeToolInvocations(store, tell).bind({}, invoke)))._tag,
          ).toBe("Failure");
          yield* tell(
            envelope(
              { _tag: "AdoptTaskAssignment", taskId: "kept", assignment: "2", runId },
              { conversation, by: { kind: "task", taskId: "kept", assignment: "2" } },
            ),
          );
          const recovered = makeToolInvocations(yield* makeEngineStore(), tell);
          expect(
            (yield* recovered.bind({}, { ...invoke, resolveTurn: () => Effect.succeed(runId) }))
              .scope,
          ).toEqual({ kind: "task", taskId: "kept", assignment: "1" });
        }),
    );
  });
});
