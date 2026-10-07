// @effect-diagnostics nodeBuiltinImport:off - a test database file is a Node filesystem boundary.
/**
 * A process lifetime over a SQLite file: the engine's layers built fresh on the same file, so a
 * "crash" is the end of one lifetime (nothing in memory survives) and a "restart" is the next one
 * with a new boot id. The world (the provider outside the process) survives in plain memory.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  BootId,
  type ConversationId,
  type EffectOutcome,
  type KnownEngineEvent,
  type WakeId,
} from "@t3tools/contracts";

import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import * as ConversationsModule from "../Conversations.ts";
import { Conversations } from "../Conversations.ts";
import type { SessionOpenedValue } from "../domain/decide.ts";
import { fold } from "../domain/evolve.ts";
import { wakeFiredCommandId } from "../domain/ids.ts";
import { initialState } from "../domain/state.ts";
import * as EngineSignals from "../EngineSignals.ts";
import * as EffectOutboxModule from "../outbox/EffectOutbox.ts";
import type { EffectRow } from "../outbox/EffectOutbox.ts";
import {
  EffectHandlers,
  handlersOf,
  type EffectHandler,
  type HandlerResult,
} from "../outbox/EffectWorker.ts";
import { EngineStore, makeEngineStore, type EngineStoreOptions } from "../store/EngineStore.ts";
import { runEngineMigrations } from "../store/migrations.ts";
import { Violation } from "./invariants.ts";

/** A fresh database file; `ENGINE_PROOF_TMP` picks the directory. */
export const tempDb = (label: string): string => {
  const dir = NodeFS.mkdtempSync(
    NodePath.join(process.env.ENGINE_PROOF_TMP ?? NodeOS.tmpdir(), `engine-proof-${label}-`),
  );
  return NodePath.join(dir, "state.sqlite");
};

export const engineLayer = (
  filename: string,
  handlers: ReadonlyMap<string, EffectHandler>,
  storeOptions: EngineStoreOptions = {},
) =>
  Layer.mergeAll(
    ConversationsModule.layer(),
    EffectOutboxModule.layer,
    Layer.succeed(EffectHandlers, handlers),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(Layer.effect(EngineStore, makeEngineStore(storeOptions)), EngineSignals.layer),
    ),
    Layer.provideMerge(
      Layer.effectDiscard(runEngineMigrations()).pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename })),
      ),
    ),
  );

export type Engine =
  | Conversations
  | EngineStore
  | EffectOutboxModule.EffectOutbox
  | EngineSignals.EngineSignals
  | EffectHandlers
  | SqlClient.SqlClient;

let boots = 0;
export const newBoot = () => BootId.make(`boot-${++boots}`);

// ── the world: the provider outside the process ─────────────────────────────────────────────

export interface WorldSession {
  alive: boolean;
}

/** What really happened outside: sessions, the words the agent got, each effect's acts. */
export class World {
  readonly sessions = new Map<string, WorldSession>();
  /** Every act a handler performed, by effect id: a re-send shows as 2. */
  readonly acts = new Map<string, number>();
  readonly received: Array<{ readonly session: string; readonly text: string }> = [];
  /** Replay-safe work that landed (its evidence). */
  readonly landed = new Set<string>();
  /** Kinds whose handler acts, then hangs: the process dies mid-effect. */
  readonly hangAfterAct = new Set<string>();
  private sessionCount = 0;

  act(row: EffectRow) {
    this.acts.set(row.effectId, (this.acts.get(row.effectId) ?? 0) + 1);
  }

  /** The server process died: every driver process died with it. */
  crash() {
    for (const session of this.sessions.values()) session.alive = false;
    this.hangAfterAct.clear();
  }

  handlers(): ReadonlyMap<string, EffectHandler> {
    const hang = (row: EffectRow, value: HandlerResult): Effect.Effect<HandlerResult> =>
      this.hangAfterAct.has(row.kind) ? Effect.never : Effect.succeed(value);
    const ok = (value?: unknown): HandlerResult => ({
      _tag: "Done",
      outcome: value === undefined ? { kind: "ok" } : { kind: "ok", value },
    });
    const failed = (reason: string): HandlerResult => ({
      _tag: "Done",
      outcome: { kind: "failed", reason },
    });
    return handlersOf(
      {
        kind: "session.open",
        run: (row) =>
          Effect.suspend(() => {
            this.act(row);
            const id = `w${++this.sessionCount}`;
            this.sessions.set(id, { alive: true });
            const payload = row.payload as { readonly model: string | null };
            const value: SessionOpenedValue = {
              sessionId: id as SessionOpenedValue["sessionId"],
              driver: "fake",
              model: payload.model,
              nativeRef: `native-${id}`,
              capabilities: { steer: false },
            };
            return hang(row, ok(value));
          }),
      },
      {
        kind: "provider.send",
        run: (row) =>
          Effect.suspend(() => {
            const payload = row.payload as { readonly sessionId: string; readonly text: string };
            if (this.sessions.get(payload.sessionId)?.alive !== true) {
              return Effect.succeed(failed("no live session"));
            }
            this.act(row);
            this.received.push({ session: payload.sessionId, text: payload.text });
            return hang(row, ok({ providerTurnId: `turn-${row.effectId}` }));
          }),
      },
      { kind: "provider.interrupt", run: (row) => Effect.sync(() => (this.act(row), ok())) },
      { kind: "provider.respond", run: (row) => Effect.sync(() => (this.act(row), ok())) },
      { kind: "provider.steer", run: (row) => Effect.sync(() => (this.act(row), ok())) },
      {
        kind: "test.replay",
        adopt: (row) =>
          Effect.sync(() =>
            this.landed.has(row.effectId)
              ? Option.some<EffectOutcome>({ kind: "ok", value: "adopted" })
              : Option.none(),
          ),
        run: (row) =>
          Effect.suspend(() => {
            this.act(row);
            this.landed.add(row.effectId);
            return hang(row, ok("acted"));
          }),
      },
    );
  }
}

// ── the scheduler's fire, as one deterministic turn ─────────────────────────────────────────

/**
 * Fires every armed wake due by `now`, earliest first, exactly as `WakeScheduler`'s loop does
 * (same query, same command id, same drop on a refusal). The built scheduler has no such seam:
 * it only offers `start`, a forever loop on the clock.
 */
export const fireDue = (now: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const conversations = yield* Conversations;
    let fired = 0;
    for (let guard = 0; guard < 100; guard++) {
      const [row] = yield* sql<{
        readonly wake_id: string;
        readonly owner_conversation_id: string;
        readonly due_at: number;
      }>`
        SELECT wake_id, owner_conversation_id, due_at FROM engine_wake
        WHERE state = 'armed' ORDER BY due_at, wake_id LIMIT 1
      `;
      if (row === undefined || row.due_at > now) return fired;
      const result = yield* conversations.tell({
        commandId: wakeFiredCommandId(row.wake_id as WakeId, row.due_at),
        conversationId: row.owner_conversation_id as ConversationId,
        principal: { kind: "engine" },
        command: { _tag: "WakeFired", wakeId: row.wake_id as WakeId },
      });
      if (result._tag === "Rejected") {
        yield* sql`UPDATE engine_wake SET state = 'dropped' WHERE wake_id = ${row.wake_id} AND state = 'armed' AND due_at = ${row.due_at}`;
      }
      fired++;
    }
    return yield* Effect.die(
      new Violation(
        "a wake fires at most once",
        "the scheduler fired 100 times without the wake leaving 'armed'",
      ),
    );
  });

// ── the audit: what must hold in the file after any step, crash or boot ─────────────────────

const normalize = (value: unknown) => JSON.stringify(value);

export const audit = (conversation: ConversationId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* EngineStore;
    const problems: Array<string> = [];
    const events = (yield* store.events(
      conversation,
      0,
      1_000_000,
    )) as ReadonlyArray<KnownEngineEvent>;
    // One gapless sequence; the head agrees.
    events.forEach((event, i) => {
      if (event.seq !== i + 1) problems.push(`gapless: event ${i} has seq ${event.seq}`);
    });
    const [head] = yield* sql<{
      readonly head_seq: number;
    }>`SELECT head_seq FROM engine_conversation WHERE conversation_id = ${conversation}`;
    if ((head?.head_seq ?? 0) !== events.length)
      problems.push(`gapless: head ${head?.head_seq} vs ${events.length} events`);
    // The conversation loads, and a snapshot plus its tail is the full fold.
    const loaded = yield* Effect.exit(store.load(conversation));
    const full = fold(initialState(conversation), events);
    if (loaded._tag === "Failure") problems.push(`loads: ${String(loaded.cause).slice(0, 300)}`);
    else if (normalize(loaded.value) !== normalize(full))
      problems.push("loads: snapshot + tail differs from the full fold");
    // Every run ends at most once.
    const endings = new Map<string, number>();
    for (const event of events)
      if (event._tag === "RunEnded") endings.set(event.runId, (endings.get(event.runId) ?? 0) + 1);
    for (const [run, n] of endings) if (n > 1) problems.push(`ends once: ${run} ended ${n} times`);
    // No effect without its record, no record without its row.
    const rows = yield* sql<{
      readonly effect_id: string;
      readonly state: string;
    }>`SELECT effect_id, state FROM engine_effect WHERE conversation_id = ${conversation}`;
    const requested = new Set(
      events.flatMap((e) => (e._tag === "EffectRequested" ? [e.effectId as string] : [])),
    );
    const rowIds = new Set(rows.map((row) => row.effect_id));
    for (const id of requested)
      if (!rowIds.has(id)) problems.push(`no effect without its row: ${id} has no outbox row`);
    for (const id of rowIds)
      if (!requested.has(id)) problems.push(`no row without its record: ${id}`);
    // An outcome recorded settles its row.
    for (const event of events) {
      if (event._tag !== "EffectOutcomeRecorded") continue;
      const row = rows.find((r) => r.effect_id === event.effectId);
      if (row !== undefined && (row.state === "pending" || row.state === "running")) {
        problems.push(
          `settled: ${event.effectId} recorded ${event.outcome.kind} but its row is ${row.state}`,
        );
      }
    }
    // Receipts never stay pending.
    const [pending] = yield* sql<{
      readonly n: number;
    }>`SELECT count(*) AS n FROM engine_receipt WHERE status = 'pending'`;
    if ((pending?.n ?? 0) > 0) problems.push(`receipts: ${pending!.n} pending`);
    // The projections agree with the fold.
    for (const run of Object.values(full.runs)) {
      const [row] = yield* sql<{
        readonly state: string;
      }>`SELECT state FROM engine_run WHERE run_id = ${run.id}`;
      if (row?.state !== run.state)
        problems.push(`projection: run ${run.id} is ${row?.state}, fold says ${run.state}`);
    }
    const armed = yield* sql<{
      readonly wake_id: string;
    }>`SELECT wake_id FROM engine_wake WHERE owner_conversation_id = ${conversation} AND state = 'armed' ORDER BY wake_id`;
    const want = Object.keys(full.wakes).sort();
    if (normalize(armed.map((row) => row.wake_id)) !== normalize(want)) {
      problems.push(`projection: armed wakes ${armed.map((row) => row.wake_id)} vs fold ${want}`);
    }
    return { problems, events, state: full };
  });
