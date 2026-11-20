import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ConversationAgent, ConversationId, type ThreadLease } from "@t3tools/contracts";

import type { Command } from "../domain/command.ts";
import { decide } from "../domain/decide.ts";
import { fold } from "../domain/evolve.ts";
import { STATE_VERSION, initialState, type ConversationState } from "../domain/state.ts";
import {
  T0,
  conversation,
  drive,
  ended,
  envelope,
  opened,
  prepared,
  r,
  send,
  sent,
  signal,
  sqliteWithEngineTables,
  turn,
} from "../testing/fixtures.ts";
import { makeEngineStore } from "./EngineStore.ts";

/** Each engine table's row count, by name. */
const counts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'engine%' ORDER BY name
  `;
  const result: Record<string, number> = {};
  for (const { name } of tables) {
    const [row] = yield* sql<{ readonly n: number }>`SELECT count(*) AS n FROM ${sql(name)}`;
    result[name] = row!.n;
  }
  return result;
});

const conversationRow = (id: ConversationId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{
      readonly head_seq: number;
      readonly snapshot_seq: number | null;
      readonly agent_json: string | null;
    }>`
      SELECT head_seq, snapshot_seq, agent_json FROM engine_conversation
      WHERE conversation_id = ${id}
    `;
    return row;
  });

const lease: ThreadLease = {
  alias: "webpool-3",
  pool: "webpool",
  branch: "feat-x",
  repo: "https://hq.example.zerops.app/git/acme/web",
};
const bindLease = envelope({ _tag: "BindLease", lease }, { by: { kind: "engine" } });

/** Run n from the person's message to its turn's end; the first run opens the session. */
const runCycle = (n: number): ReadonlyArray<Command> => [
  send(`message ${n}`),
  prepared(n),
  ...(n === 1 ? [opened(1)] : []),
  sent(n),
  ended(n),
];

// witness: apps/server/src/engine/store/EngineStore.ts | for (const effect of step.effects) { → for (const effect of step.effects.slice(1)) {
it.effect(
  "ES1: A step's events, its run and item rows and its queued effects are written by one commit; breaks: a run the record shows admitted with no effect queued to carry it never starts",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* makeEngineStore();
      const state = initialState(conversation);
      const env = envelope(send("ship it"));
      const decision = decide(state, env, T0);
      const committed = yield* store.commit({ envelope: env, decision, state, now: T0 });
      const result = committed.result;
      const runId = result._tag === "Accepted" ? result.runId : null;
      const itemId = result._tag === "Accepted" ? result.itemId : null;
      const events = yield* sql<{ readonly type: string; readonly command_id: string }>`
        SELECT type, command_id FROM engine_event ORDER BY seq
      `;
      const runs = yield* sql<{ readonly run_id: string; readonly state: string }>`
        SELECT run_id, state FROM engine_run
      `;
      const items = yield* sql<{ readonly item_id: string; readonly kind: string }>`
        SELECT item_id, kind FROM engine_item
      `;
      const effects = yield* sql<{
        readonly effect_id: string;
        readonly run_id: string;
        readonly state: string;
      }>`
        SELECT effect_id, run_id, state FROM engine_effect ORDER BY effect_id
      `;
      const drafts = decision._tag === "Accept" ? decision.step : null;
      expect({ result: result._tag, events, runs, items, effects }).toEqual({
        result: "Accepted",
        events: (drafts?.events ?? []).map((draft) => ({
          type: draft._tag,
          command_id: env.commandId,
        })),
        runs: [{ run_id: runId, state: "admitted" }],
        items: [{ item_id: itemId, kind: "person" }],
        effects: (drafts?.effects ?? [])
          .map((effect) => ({ effect_id: effect.effectId, run_id: runId, state: "pending" }))
          .sort((a, b) => a.effect_id.localeCompare(b.effect_id)),
      });
      expect(effects.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

/** The writes a person's first message makes after its receipt is reserved, each failed by a trigger. */
const failingWrites = [
  { table: "engine_event", on: "INSERT" },
  { table: "engine_run", on: "INSERT" },
  { table: "engine_item", on: "INSERT" },
  { table: "engine_effect", on: "INSERT" },
  { table: "engine_receipt", on: "UPDATE" },
  { table: "engine_conversation", on: "INSERT" },
] as const;

// witness: apps/server/src/engine/store/EngineStore.ts | sql.withTransaction(commitStep(input)) → commitStep(input)
it.effect(
  "ES2: A write that fails anywhere inside a step leaves no receipt, event, run, item, effect or conversation row of it, and the same command then commits whole; breaks: a half-written receipt makes the retry a duplicate and the person's message is lost",
  () =>
    Effect.gen(function* () {
      for (const write of failingWrites) {
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const store = yield* makeEngineStore();
          const state = initialState(conversation);
          const env = envelope(send(), { id: "send-1" });
          const decision = decide(state, env, T0);
          const before = yield* counts;
          yield* sql.unsafe(
            `CREATE TRIGGER fail_write BEFORE ${write.on} ON ${write.table} ` +
              `BEGIN SELECT RAISE(ABORT, 'fault'); END`,
          );
          const failed = yield* Effect.exit(
            store.commit({ envelope: env, decision, state, now: T0 }),
          );
          expect({ write, failed: failed._tag, rows: yield* counts }).toEqual({
            write,
            failed: "Failure",
            rows: before,
          });

          yield* sql.unsafe(`DROP TRIGGER fail_write`);
          const retried = yield* Effect.exit(
            store.commit({ envelope: env, decision, state, now: T0 }),
          );
          expect({
            write,
            duplicate: Exit.isSuccess(retried) ? retried.value.duplicate : retried._tag,
            events: Exit.isSuccess(retried) ? retried.value.events.length : retried._tag,
          }).toEqual({
            write,
            duplicate: false,
            events: decision._tag === "Accept" ? decision.step.events.length : 0,
          });
        }).pipe(Effect.provide(sqliteWithEngineTables));
      }
    }),
);

// witness: apps/server/src/engine/store/EngineStore.ts | if (reserved.length === 0) { → if (reserved.length < 0) {
it.effect(
  "ES3: A command committed again under its id, accepted or rejected, returns its first answer and writes nothing; breaks: a client's resend sends the message twice",
  () =>
    Effect.gen(function* () {
      const store = yield* makeEngineStore();
      const message = envelope(send("once"), { id: "client-7" });
      const quiet = ConversationId.make("quiet");
      const stop = envelope({ _tag: "Stop" }, { id: "stop-9", conversation: quiet });
      const accepted = yield* drive(store, initialState(conversation), [message]);
      const rejected = yield* drive(store, initialState(quiet), [stop]);
      const before = yield* counts;

      const resend = (env: typeof message, state: ConversationState) =>
        Effect.exit(
          store.commit({ envelope: env, decision: decide(state, env, T0 + 1), state, now: T0 + 1 }),
        ).pipe(
          Effect.map((exit) =>
            Exit.isSuccess(exit)
              ? {
                  result: exit.value.result,
                  duplicate: exit.value.duplicate,
                  events: exit.value.events.length,
                }
              : exit._tag,
          ),
        );
      const messageAgain = yield* resend(message, accepted.state);
      const stopAgain = yield* resend(stop, rejected.state);
      expect({
        firsts: [accepted.last?.result._tag, rejected.last?.result._tag],
        messageAgain,
        stopAgain,
        rows: yield* counts,
      }).toEqual({
        firsts: ["Accepted", "Rejected"],
        messageAgain: { result: accepted.last?.result, duplicate: true, events: 0 },
        stopAgain: { result: rejected.last?.result, duplicate: true, events: 0 },
        rows: before,
      });
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

// witness: apps/server/src/engine/store/EngineStore.ts | seq: head + index + 1, → seq: head + index + 2,
it.effect(
  "ES4: A conversation's events are numbered without a gap, each conversation on its own, and a rejected command takes no number; breaks: a reader waiting for the missing number stalls the conversation",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* makeEngineStore();
      const other = ConversationId.make("other");
      const stop = envelope({ _tag: "Stop", runId: r(9) }, { id: "stop-early" });
      const played = yield* Effect.exit(
        Effect.gen(function* () {
          const first = yield* drive(store, initialState(conversation), [send()]);
          const refused = yield* drive(store, first.state, [stop]);
          const mate = yield* drive(store, refused.state, [
            prepared(1),
            opened(1),
            sent(1),
            ended(1),
            send("again"),
          ]);
          yield* drive(store, initialState(other), [envelope(send(), { conversation: other })]);
          return { refused: refused.last?.result._tag, head: mate.state.headSeq };
        }),
      );
      const rows = yield* sql<{
        readonly conversation_id: string;
        readonly seq: number;
        readonly command_id: string;
      }>`
        SELECT conversation_id, seq, command_id FROM engine_event ORDER BY gseq
      `;
      const seqs = (id: ConversationId) =>
        rows.filter((row) => row.conversation_id === id).map((row) => row.seq);
      const numbered = (id: ConversationId) => seqs(id).map((_, index) => index + 1);
      const heads = {
        mate: (yield* conversationRow(conversation))?.head_seq,
        other: (yield* conversationRow(other))?.head_seq,
      };
      expect({
        played: Exit.isSuccess(played) ? played.value.refused : played._tag,
        mate: seqs(conversation),
        other: seqs(other),
        heads,
        stopEvents: rows.filter((row) => row.command_id === stop.commandId).length,
      }).toEqual({
        played: "Rejected",
        mate: numbered(conversation),
        other: numbered(other),
        heads: { mate: seqs(conversation).length, other: seqs(other).length },
        stopEvents: 0,
      });
      expect(seqs(other).length).toBeGreaterThan(0);
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

// witness: apps/server/src/engine/store/EngineStore.ts | if (head !== state.headSeq) { → if (false) {
it.effect(
  "ES5: A commit from a state older than the stored head is refused and writes nothing, so the actor reloads; breaks: two writers interleave their events",
  () =>
    Effect.gen(function* () {
      const store = yield* makeEngineStore();
      const { state: older } = yield* drive(store, initialState(conversation), [send("first")]);
      const current = yield* drive(store, older, [bindLease]);
      const before = yield* counts;
      // Another writer's step from the state before the lease was bound.
      const env = envelope(
        { _tag: "BindLease", lease: { ...lease, alias: "webpool-4" } },
        { by: { kind: "engine" } },
      );
      const late = yield* Effect.exit(
        store.commit({ envelope: env, decision: decide(older, env, T0), state: older, now: T0 }),
      );
      expect({
        late: late._tag,
        rows: yield* counts,
        loaded: yield* store.load(conversation),
      }).toEqual({ late: "Failure", rows: before, loaded: current.state });
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

// witness: apps/server/src/engine/store/EngineStore.ts | jsonText({ v: domain.stateVersion, state: next }) → jsonText({ v: domain.stateVersion, state: { ...next, lease: undefined } })
it.effect(
  "ES6: A conversation loads from its snapshot and the events after it to the same state as a fold of its whole record, its lease included; breaks: after a restart the conversation is not the one its record holds",
  () =>
    Effect.gen(function* () {
      const store = yield* makeEngineStore();
      let state = (yield* drive(store, initialState(conversation), [bindLease])).state;
      const compared: Array<{
        readonly loaded: ConversationState;
        readonly folded: ConversationState;
        readonly actor: ConversationState;
      }> = [];
      let tailFolds = 0;
      for (let n = 1; n <= 60 && tailFolds === 0; n++) {
        for (const command of runCycle(n)) {
          state = (yield* drive(store, state, [command])).state;
          const row = yield* conversationRow(conversation);
          if (row?.snapshot_seq == null) continue;
          if (row.snapshot_seq < row.head_seq) tailFolds++;
          // A restart: a new store reads the conversation from its record alone.
          const loaded = yield* (yield* makeEngineStore()).load(conversation);
          const folded = fold(initialState(conversation), yield* store.events(conversation, 0));
          compared.push({ loaded, folded, actor: state });
        }
      }
      const loaded = compared.map((each) => each.loaded);
      expect({ tailFolds: tailFolds > 0, lease: state.lease, loaded, loadedAgain: loaded }).toEqual(
        {
          tailFolds: true,
          lease,
          loaded: compared.map((each) => each.folded),
          loadedAgain: compared.map((each) => each.actor),
        },
      );
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

// witness: apps/server/src/engine/store/EngineStore.ts | if (snapshot.v === domain.stateVersion) state = snapshot.state; → state = snapshot.state;
it.effect(
  "ES7: A snapshot of another state version is never read: the conversation is folded from its record; breaks: a release that changes the state's shape loads its conversations wrong",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* makeEngineStore();
      const { state } = yield* drive(store, initialState(conversation), [
        bindLease,
        ...runCycle(1),
      ]);
      // An older build's snapshot at the head: it knew no lease.
      const { lease: _lease, ...older } = state;
      yield* sql`
        UPDATE engine_conversation
        SET snapshot_json = ${JSON.stringify({ v: STATE_VERSION - 1, state: older })},
          snapshot_seq = ${state.headSeq}
        WHERE conversation_id = ${conversation}
      `;
      const loaded = yield* (yield* makeEngineStore()).load(conversation);
      expect({ lease: loaded.lease, loaded }).toEqual({
        lease,
        loaded: fold(initialState(conversation), yield* store.events(conversation, 0)),
      });
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

const decodeAgent = Schema.decodeUnknownSync(Schema.fromJsonString(ConversationAgent));

// witness: apps/server/src/engine/store/EngineStore.ts | const agent = json(domain.rowAgent(next)); → const agent = json(domain.rowAgent(state));
it.effect(
  "ES8: The conversation's row names the agent it belongs to, as the boot and the usage watch read it; breaks: after a restart the conversation's agent is unknown and its usage unwatched",
  () =>
    Effect.gen(function* () {
      const store = yield* makeEngineStore();
      const agent = {
        instanceId: "codex-bo",
        driver: "codex",
        model: "gpt-5",
        profile: { kind: "crewmate", id: "c1", name: "Bo" },
      } as const;
      yield* drive(store, initialState(conversation), [{ _tag: "AssignAgent", agent }]);
      const row = yield* conversationRow(conversation);
      const stored = row?.agent_json == null ? null : decodeAgent(row.agent_json);
      expect(stored).toEqual(agent);
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);

// witness: apps/server/src/engine/store/EngineStore.ts | if (unreadable._tag === "Failure") { → if (false) {
it.effect(
  "ES9: A step whose event this build cannot encode (a driver's call state the contracts do not know) is refused as invalid-signal, writing only its receipt, and the conversation still loads; breaks: one unreadable event makes the conversation unloadable for good",
  () =>
    Effect.gen(function* () {
      const store = yield* makeEngineStore();
      const running = yield* drive(store, initialState(conversation), [
        send("go"),
        prepared(1),
        opened(1),
        sent(1),
      ]);
      const before = yield* counts;
      // The bridge's item status `cut` passed through as a call state this build does not know.
      const body = {
        kind: "call",
        step: "build",
        tool: { name: "Bash" },
        words: null,
        state: "cut",
        endedAt: null,
      };
      const env = envelope(
        signal({
          kind: "item-opened",
          turn: turn(1),
          key: "k1",
          by: { kind: "mate" },
          body: body as never,
        }),
        { by: { kind: "engine" } },
      );
      const refused = yield* Effect.exit(
        store.commit({
          envelope: env,
          decision: decide(running.state, env, T0),
          state: running.state,
          now: T0,
        }),
      );
      const reloaded = yield* Effect.exit((yield* makeEngineStore()).load(conversation));
      const result = Exit.isSuccess(refused) ? refused.value.result : null;
      expect({
        refused: Exit.isSuccess(refused) ? refused.value.result._tag : refused._tag,
        reason: result?._tag === "Rejected" ? result.rejection.reason : null,
        rows: yield* counts,
        reloaded: Exit.isSuccess(reloaded) ? reloaded.value : reloaded._tag,
      }).toEqual({
        refused: "Rejected",
        reason: "invalid-signal",
        rows: { ...before, engine_receipt: before.engine_receipt! + 1 },
        reloaded: running.state,
      });
    }).pipe(Effect.provide(sqliteWithEngineTables)),
);
