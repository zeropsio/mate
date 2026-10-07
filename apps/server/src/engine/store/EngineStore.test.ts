import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { decide } from "../domain/decide.ts";
import { fold } from "../domain/evolve.ts";
import { initialState } from "../domain/state.ts";
import {
  T0,
  conversation,
  drive,
  envelope,
  opened,
  r,
  send,
  sent,
  signal,
  sqliteWithEngineTables,
  turnEnded,
} from "../testing/fixtures.ts";
import { EngineStoreError, makeEngineStore, type CommitStage } from "./EngineStore.ts";

const TABLES = [
  "engine_receipt",
  "engine_event",
  "engine_conversation",
  "engine_run",
  "engine_item",
  "engine_effect",
] as const;

const counts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const result: Record<string, number> = {};
  for (const table of TABLES) {
    const [row] = yield* sql<{ readonly n: number }>`SELECT count(*) AS n FROM ${sql(table)}`;
    result[table] = row!.n;
  }
  return result;
});

const nothingWritten = Object.fromEntries(TABLES.map((table) => [table, 0]));

describe("EngineStore", () => {
  it.layer(sqliteWithEngineTables)("commit", (it) => {
    it.effect("writes a step's events, projections and outbox rows together", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* makeEngineStore();
        const { last } = yield* drive(store, initialState(conversation), [send("ship it")]);
        const [run] = yield* sql<{ readonly state: string; readonly rev: number }>`
          SELECT state, rev FROM engine_run WHERE run_id = ${r(1)}
        `;
        const [item] = yield* sql<{ readonly kind: string }>`
          SELECT kind FROM engine_item WHERE item_id = ${`${r(1)}/i/1`}
        `;
        const effects = yield* sql<{ readonly kind: string; readonly state: string }>`
          SELECT kind, state FROM engine_effect
        `;
        assert.deepStrictEqual(
          { result: last?.result, run, item, effects, enqueued: last?.enqueued },
          {
            result: { _tag: "Accepted", seq: 4, runId: r(1), itemId: `${r(1)}/i/1` },
            run: { state: "admitted", rev: 3 },
            item: { kind: "person" },
            effects: [{ kind: "session.open", state: "pending" }],
            enqueued: true,
          },
        );
      }),
    );
  });

  describe("a fault between statements leaves nothing visible", () => {
    const stages: ReadonlyArray<CommitStage> = [
      "receipt",
      "events",
      "projections",
      "outbox",
      "settle",
      "snapshot",
    ];
    for (const stage of stages) {
      it.layer(sqliteWithEngineTables)(`after the ${stage} stage`, (it) => {
        it.effect("rolls the whole step back and lets the command run again", () =>
          Effect.gen(function* () {
            const faulty = yield* makeEngineStore({
              snapshotEvery: 1,
              fault: (at) =>
                at === stage
                  ? Effect.fail(new EngineStoreError({ operation: "fault", cause: stage }))
                  : Effect.void,
            });
            const env = envelope(send(), { id: "send-1" });
            const state = initialState(conversation);
            const decision = decide(state, env, T0);
            const failed = yield* Effect.flip(
              faulty.commit({ envelope: env, decision, state, now: T0 }),
            );
            const afterFault = yield* counts;

            const store = yield* makeEngineStore();
            const retried = yield* store.commit({ envelope: env, decision, state, now: T0 });
            assert.deepStrictEqual(
              {
                failed: failed._tag,
                afterFault,
                duplicate: retried.duplicate,
                events: retried.events.length,
              },
              {
                failed: "EngineStoreError",
                afterFault: nothingWritten,
                duplicate: false,
                events: 4,
              },
            );
          }),
        );
      });
    }
  });

  it.layer(sqliteWithEngineTables)("receipts", (it) => {
    it.effect("a duplicate command returns the stored result and writes nothing", () =>
      Effect.gen(function* () {
        const store = yield* makeEngineStore();
        const env = envelope(send("once"), { id: "client-7" });
        const first = yield* drive(store, initialState(conversation), [env]);
        const before = yield* counts;
        const again = yield* store.commit({
          envelope: env,
          decision: decide(first.state, env, T0 + 1),
          state: first.state,
          now: T0 + 1,
        });
        assert.deepStrictEqual(
          {
            result: again.result,
            duplicate: again.duplicate,
            events: again.events,
            after: yield* counts,
          },
          { result: first.last!.result, duplicate: true, events: [], after: before },
        );
      }),
    );

    it.effect("a duplicate of a rejected command returns the same rejection", () =>
      Effect.gen(function* () {
        const store = yield* makeEngineStore();
        const quiet = "quiet" as typeof conversation;
        const env = envelope({ _tag: "Stop" }, { id: "stop-9", conversation: quiet });
        const first = yield* drive(store, initialState(quiet), [env]);
        const again = yield* drive(store, first.state, [env]);
        expect(first.last?.result).toEqual({
          _tag: "Rejected",
          rejection: { reason: "run-not-running" },
        });
        expect(again.last).toMatchObject({ duplicate: true, result: first.last!.result });
      }),
    );
  });

  it.layer(sqliteWithEngineTables)("sequence", (it) => {
    it.effect("seq is gapless per conversation, rejections taking none", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* makeEngineStore();
        const other = "other" as typeof conversation;
        yield* drive(store, initialState(conversation), [
          send(),
          { _tag: "Stop", runId: r(9) },
          opened(1),
          sent(1),
          turnEnded,
          send("again"),
        ]);
        yield* drive(store, initialState(other), [envelope(send(), { conversation: other })]);
        const rows = yield* sql<{ readonly conversation_id: string; readonly seq: number }>`
          SELECT conversation_id, seq FROM engine_event ORDER BY gseq
        `;
        for (const id of [conversation, other]) {
          const seqs = rows.filter((row) => row.conversation_id === id).map((row) => row.seq);
          expect(seqs).toEqual(seqs.map((_, index) => index + 1));
        }
      }),
    );

    it.effect("a commit from a stale state is refused, so the actor reloads", () =>
      Effect.gen(function* () {
        const store = yield* makeEngineStore();
        const stale = initialState(conversation);
        const env = envelope(send("late"));
        const error = yield* Effect.flip(
          store.commit({ envelope: env, decision: decide(stale, env, T0), state: stale, now: T0 }),
        );
        expect(error.message).toContain("stale state");
      }),
    );
  });

  it.layer(sqliteWithEngineTables)("load", (it) => {
    it.effect("a snapshot plus its tail folds to the same state as the full log", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* makeEngineStore({ snapshotEvery: 5 });
        const script = [
          send(),
          opened(1),
          sent(1),
          signal(
            { kind: "item-opened", key: "a", by: { kind: "mate" }, body: note("a") },
            {
              kind: "request-opened",
              key: "q",
              ask: { kind: "plan", planItemId: `${r(1)}/i/2` as never },
            },
          ),
          send("queued"),
          turnEnded,
          sent(2),
          signal({ kind: "item-opened", key: "b", by: { kind: "mate" }, body: note("b") }),
          signal({ kind: "item-closed", key: "b", body: note("b") }),
          turnEnded,
        ];
        let state = initialState(conversation);
        let tailFolds = 0;
        for (const command of script) {
          state = (yield* drive(store, state, [command])).state;
          const [row] = yield* sql<{
            readonly snapshot_seq: number | null;
            readonly head_seq: number;
          }>`
            SELECT snapshot_seq, head_seq FROM engine_conversation
          `;
          if (row!.snapshot_seq !== null && row!.snapshot_seq < row!.head_seq) tailFolds++;
          const full = fold(initialState(conversation), yield* store.events(conversation, 0));
          const loaded = yield* store.load(conversation);
          expect(loaded).toEqual(full);
          expect(loaded).toEqual(state);
        }
        expect(tailFolds).toBeGreaterThan(0);
      }),
    );

    it.effect("an event from a newer engine is read as Unknown and only moves the head", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* makeEngineStore();
        const before = yield* store.load(conversation);
        yield* sql`
          INSERT INTO engine_event (conversation_id, seq, type, v, at, command_id, payload_json)
          VALUES (${conversation}, ${before.headSeq + 1}, 'RunTeleported', 2, ${T0}, 'future', '{}')
        `;
        const after = yield* store.load(conversation);
        const [event] = yield* store.events(conversation, before.headSeq);
        expect(event).toMatchObject({ _tag: "Unknown", type: "RunTeleported" });
        expect(after).toEqual({ ...before, headSeq: before.headSeq + 1 });
      }),
    );
  });

  it.layer(sqliteWithEngineTables)("item detail", (it) => {
    it.effect("keeps an item's full body apart from its summary, read on demand", () =>
      Effect.gen(function* () {
        const store = yield* makeEngineStore();
        yield* drive(store, initialState(conversation), [
          send(),
          opened(1),
          sent(1),
          signal({
            kind: "item-closed",
            key: "cmd",
            by: { kind: "mate" },
            body: {
              kind: "call",
              step: "command",
              tool: { name: "bash" },
              words: "build",
              state: "done",
              endedAt: T0,
            },
            detail: "full output\n".repeat(3),
          }),
        ]);
        const detail = yield* store.itemDetail(`${r(1)}/i/2` as never);
        const missing = yield* store.itemDetail(`${r(1)}/i/9` as never);
        expect(Option.getOrNull(detail)).toBe("full output\n".repeat(3));
        expect(Option.isNone(missing)).toBe(true);
      }),
    );
  });
});

const note = (key: string) =>
  ({ kind: "note", text: `note ${key}`, streaming: true, answer: false }) as const;
