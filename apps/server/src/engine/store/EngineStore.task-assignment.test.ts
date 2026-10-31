import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { CommandId, ConversationId } from "@t3tools/contracts";
import { decide } from "../domain/decide.ts";
import { initialState } from "../domain/state.ts";
import { drive, sqliteWithEngineTables } from "../testing/fixtures.ts";
import { EngineStoreError, makeEngineStore } from "./EngineStore.ts";

const conversationId = ConversationId.make("mate-tasks");
const envelope = {
  conversationId,
  commandId: CommandId.make("task:first:1"),
  principal: { kind: "task", taskId: "first", assignment: "9007199254740993" },
  command: {
    _tag: "Send",
    taskId: "first",
    taskAssignment: "9007199254740993",
    text: "Actual brief",
  },
} as const;

describe("the task grant commit", () => {
  it.layer(sqliteWithEngineTables)("durable receipts", (it) => {
    it.effect(
      "a committed grant survives loss of its acknowledgement and replay starts no extra run",
      () =>
        Effect.gen(function* () {
          const first = yield* makeEngineStore({ snapshotEvery: 1 });
          yield* drive(first, initialState(conversationId), [envelope]);
          // Nothing acknowledges the result. A fresh store reconstructs only SQL.
          const fresh = yield* makeEngineStore();
          const loaded = yield* fresh.load(conversationId);
          expect(loaded.taskAssignments.first).toEqual({
            assignment: "9007199254740993",
            state: "active",
          });
          const replay = yield* fresh.commit({
            envelope,
            state: loaded,
            decision: decide(loaded, envelope, 2_000_000),
            now: 2_000_000,
          });
          expect(replay.duplicate).toBe(true);
          expect(replay.events).toEqual([]);
          const sql = yield* SqlClient.SqlClient;
          const [row] = yield* sql<{
            readonly count: number;
          }>`SELECT count(*)AS count FROM engine_run WHERE conversation_id=${conversationId}`;
          expect(row?.count).toBe(1);
          const actualRun = Object.values(loaded.runs)[0]!;
          const adoption = {
            ...envelope,
            commandId: CommandId.make("task:adopt:9007199254740994"),
            principal: { kind: "task", taskId: "first", assignment: "9007199254740994" },
            command: {
              _tag: "AdoptTaskAssignment",
              taskId: "first",
              assignment: "9007199254740994",
              runId: actualRun.id,
            },
          } as const;
          yield* fresh.commit({
            envelope: adoption,
            state: loaded,
            decision: decide(loaded, adoption, 3_000_000),
            now: 3_000_000,
          });
          const recovered = yield* makeEngineStore();
          const kept = yield* recovered.load(conversationId);
          expect(kept.runs[actualRun.id]?.taskAssignment).toBe("9007199254740994");
          expect(kept.runs[actualRun.id]?.principal).toEqual(envelope.principal);
          const adoptedAgain = yield* recovered.commit({
            envelope: adoption,
            state: kept,
            decision: decide(kept, adoption, 4_000_000),
            now: 4_000_000,
          });
          expect(adoptedAgain.duplicate).toBe(true);
          expect(adoptedAgain.events).toEqual([]);
          const [projected] = yield* sql<{
            readonly task_assignment: string;
          }>`SELECT task_assignment FROM engine_run WHERE run_id=${actualRun.id}`;
          expect(projected?.task_assignment).toBe("9007199254740994");
        }),
    );
    it.effect("a failed engine commit leaves no task binding, run or accepted receipt", () =>
      Effect.gen(function* () {
        const failedId = ConversationId.make("uncommitted-tasks");
        const failedEnvelope = { ...envelope, conversationId: failedId };
        const failing = yield* makeEngineStore({
          fault: (stage) =>
            stage === "projections"
              ? Effect.fail(
                  new EngineStoreError({
                    operation: "assignment-test",
                    cause: new Error("synthetic SQL boundary"),
                  }),
                )
              : Effect.void,
        });
        const result = yield* Effect.result(
          drive(failing, initialState(failedId), [failedEnvelope]),
        );
        expect(result._tag).toBe("Failure");
        const fresh = yield* makeEngineStore();
        expect((yield* fresh.load(failedId)).taskAssignments).toEqual({});
        const sql = yield* SqlClient.SqlClient;
        const [row] = yield* sql<{
          readonly count: number;
        }>`SELECT (SELECT count(*)FROM engine_run WHERE conversation_id=${failedId})+(SELECT count(*)FROM engine_receipt WHERE conversation_id=${failedId})+(SELECT count(*)FROM engine_event WHERE conversation_id=${failedId})AS count`;
        expect(row?.count).toBe(0);
      }),
    );
  });
});
