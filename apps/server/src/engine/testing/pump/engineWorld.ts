// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off unsafeEffectTypeAssertion:off - a test harness: a database file, rows read back plainly, one context per life.
/**
 * The running engine for end-to-end tests: the live layer (store, actors, outbox, handlers, live
 * plane, pump) on a SQLite file, over a scripted ProviderService and a WorkspaceHistory that
 * remembers what it was asked. A life is one process: `boot` builds the layers and starts the
 * engine, `shutdown` closes them as a graceful stop does, `crash` kills every driver process
 * first; the next `boot` is the restart, on the same file, with drivers that hold nothing.
 *
 * Time is the test clock: `settle` lets every fiber run to its next wait, `advance` moves the
 * clock (wakes come due) and settles.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import {
  CommandId,
  ConversationId,
  type Principal,
  type RunEnd,
  type RunId,
  type RunState,
} from "@t3tools/contracts";

import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import type { BridgeDriver } from "../../bridge/spi3.ts";
import { Conversations } from "../../Conversations.ts";
import type { Command } from "../../domain/command.ts";
import { liveEngineLayer } from "../../live.ts";
import { LiveBus } from "../../LiveBus.ts";
import { MateEngine } from "../../MateEngine.ts";
import { AgentWorkspace, RestartEvidence, RunAdmission, RunRefused } from "../../ports.ts";
import { providerThreadOf, TurnPump } from "../../pump/TurnPump.ts";
import { makeFakeWorkspaceHistory } from "./fakeWorkspaceHistory.ts";
import {
  makeScriptedProvider,
  scriptedProviderLayer,
  type ScriptedProvider,
} from "./scriptedProvider.ts";

export const DRIVERS: ReadonlyArray<BridgeDriver> = [
  "claudeAgent",
  "codex",
  "opencode",
  "cursor",
  "grok",
  "antigravity",
];

export const ana: Principal = { kind: "person", subject: "zerops:ana" };
export const mate = ConversationId.make("mate");

export interface RunRow {
  readonly state: RunState;
  readonly end: RunEnd | null;
  readonly source: string | null;
  readonly joins: string | null;
  readonly trigger: { readonly kind: string; readonly cause?: string };
  readonly unresponsiveSince: number | null;
}

export interface WorldOptions {
  readonly driver: BridgeDriver;
  /** Admission refuses every run with these words, or the principals this names. */
  readonly refuse?: string | ((principal: Principal) => string | undefined);
  /** Admission itself breaks (a defect) with these words. */
  readonly admissionDies?: string;
}

let lives = 0;

export const makeEngineWorld = (options: WorldOptions) =>
  Effect.gen(function* () {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "engine-pump-"));
    const filename = NodePath.join(dir, "state.sqlite");
    const history = makeFakeWorkspaceHistory();
    const thread = providerThreadOf(mate) as string;
    let provider: ScriptedProvider = yield* makeScriptedProvider({ driver: options.driver });
    let life: Scope.Closeable | undefined;
    let context: Context.Context<never> = Context.empty();

    const ports = Layer.mergeAll(
      Layer.succeed(
        RunAdmission,
        RunAdmission.of({
          admit: ({ principal }) => {
            if (options.admissionDies !== undefined) {
              return Effect.die(new Error(options.admissionDies));
            }
            const refusal =
              typeof options.refuse === "function" ? options.refuse(principal) : options.refuse;
            return refusal === undefined
              ? Effect.void
              : Effect.fail(new RunRefused({ message: refusal }));
          },
        }),
      ),
      Layer.succeed(
        RestartEvidence,
        RestartEvidence.of({
          read: Effect.succeed(null),
          explain: () => "Mate restarted.",
        }),
      ),
      Layer.succeed(
        AgentWorkspace,
        AgentWorkspace.of({ of: () => Effect.succeed({ cwd: dir, runtimeMode: "full-access" }) }),
      ),
    );

    const lifeLayer = (scripted: ScriptedProvider) =>
      liveEngineLayer({ worker: { pollMillis: 1_000 } }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            scriptedProviderLayer(scripted),
            history.layer,
            ports,
            NodeSqliteClient.layer({ filename }),
          ),
        ),
      );

    /** Lets every fiber run until it waits on something only time or a call can give. */
    const settle = Effect.gen(function* () {
      for (let i = 0; i < 200; i++) yield* Effect.yieldNow;
      yield* TestClock.adjust(0);
      for (let i = 0; i < 200; i++) yield* Effect.yieldNow;
    });

    const within = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
      Effect.provide(effect as Effect.Effect<A, E>, context);

    const boot = Effect.gen(function* () {
      lives += 1;
      life = yield* Scope.make();
      context = (yield* Layer.buildWithScope(lifeLayer(provider), life)) as Context.Context<never>;
      yield* within(
        Effect.gen(function* () {
          const engine = yield* MateEngine;
          yield* Scope.provide(engine.start(), life!);
        }),
      );
      yield* settle;
    });

    const shutdown = Effect.gen(function* () {
      if (life !== undefined) yield* Scope.close(life, Exit.void);
      life = undefined;
    });
    // A world leaves nothing behind: its last life ends and its file goes.
    yield* Effect.addFinalizer(() =>
      shutdown.pipe(
        Effect.andThen(Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true }))),
      ),
    );

    /** The server dies: every driver process dies with it, nothing in memory survives. */
    const crash = Effect.gen(function* () {
      for (const session of provider.sessions.values()) session.alive = false;
      yield* shutdown;
      provider = yield* makeScriptedProvider({ driver: options.driver });
    });

    let commands = 0;
    const tell = (command: Command, by: Principal = ana, conversation: ConversationId = mate) =>
      within(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          const result = yield* conversations.tell({
            commandId: CommandId.make(`test-${lives}-${++commands}`),
            conversationId: conversation,
            principal: by,
            command,
          });
          yield* settle;
          return result;
        }),
      );

    const run = (id: RunId) =>
      within(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{
            readonly state: RunState;
            readonly end_json: string | null;
            readonly end_source: string | null;
            readonly joins: string | null;
            readonly trigger_json: string;
            readonly unresponsive_since: number | null;
          }>`SELECT state, end_json, end_source, joins, trigger_json, unresponsive_since
             FROM engine_run WHERE run_id = ${id}`;
          const row = rows[0];
          if (row === undefined) return undefined;
          return {
            state: row.state,
            end: row.end_json === null ? null : (JSON.parse(row.end_json) as RunEnd),
            source: row.end_source,
            joins: row.joins,
            trigger: JSON.parse(row.trigger_json) as RunRow["trigger"],
            unresponsiveSince: row.unresponsive_since,
          } satisfies RunRow;
        }),
      );

    const runs = Effect.suspend(() =>
      within(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ readonly run_id: string; readonly state: string }>`
          SELECT run_id, state FROM engine_run ORDER BY ordinal
        `;
        }),
      ),
    );

    const items = (runId: RunId) =>
      within(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{
            readonly kind: string;
            readonly state: string;
            readonly body_json: string;
          }>`
            SELECT kind, state, body_json FROM engine_item WHERE run_id = ${runId} ORDER BY opened_seq
          `;
          return rows.map((row) => ({
            ...row,
            body: JSON.parse(row.body_json) as Record<string, unknown>,
          }));
        }),
      );

    const sessionsOpen = Effect.suspend(() =>
      within(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            readonly session_id: string;
            readonly state: string;
            readonly close_reason: string | null;
          }>`
          SELECT session_id, state, close_reason FROM engine_session ORDER BY opened_at, session_id
        `;
        }),
      ),
    );

    const requests = Effect.suspend(() =>
      within(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            readonly request_id: string;
            readonly state: string;
            readonly run_id: string;
          }>`
            SELECT request_id, state, run_id FROM engine_request ORDER BY seq
          `;
        }),
      ),
    );

    const wakes = Effect.suspend(() =>
      within(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            readonly kind: string;
            readonly due_at: number;
            readonly state: string;
          }>`
          SELECT kind, due_at, state FROM engine_wake ORDER BY due_at
        `;
        }),
      ),
    );

    return {
      dir,
      thread,
      history,
      get provider() {
        return provider;
      },
      boot,
      shutdown,
      crash,
      settle,
      advance: (millis: number) =>
        Effect.gen(function* () {
          yield* TestClock.adjust(millis);
          yield* settle;
        }),
      tell,
      run,
      runs,
      items,
      sessionsOpen,
      requests,
      wakes,
      within,
      engine: Effect.suspend(() => within(Effect.map(MateEngine, (engine) => engine))),
      pump: Effect.suspend(() => within(Effect.map(TurnPump, (pump) => pump))),
      live: Effect.suspend(() => within(Effect.map(LiveBus, (live) => live))),
      /** The agent plays out a step on the conversation's thread, then everything settles. */
      agent: <A, E>(
        act: (scripted: ScriptedProvider["agent"], thread: string) => Effect.Effect<A, E>,
      ) =>
        Effect.gen(function* () {
          const result = yield* act(provider.agent, thread);
          yield* settle;
          return result;
        }),
    };
  });

export type EngineWorld = Effect.Success<ReturnType<typeof makeEngineWorld>>;
