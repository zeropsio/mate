/**
 * The live engine (switch on `mate`): its runtime — the store and its migrations, the actors, the
 * outbox and its handlers, the live plane, the pump — and the `MateEngine` service over it.
 *
 * `start` boots it in the startup's reactor scope (`EngineBoot`). Sign-out closes the sessions of
 * every conversation whose agent runs on a signed-out instance (`CloseSession{signed-out}`); a
 * wake is the conversation's `ArmWake`, for the principal it names; a woken run's outcome is
 * read from the run the wake started. A conversation's view is read from its record and its
 * actor; its changes are its commits.
 *
 * @module engine/live
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import {
  BootId,
  CommandId,
  ConversationAgent,
  ConversationId,
  RunEnd,
  RunId,
  RunEndSource,
} from "@t3tools/contracts";

import { makeEngineUpdateDrain } from "./updateDrain.ts";
import * as ConversationsModule from "./Conversations.ts";
import { Conversations } from "./Conversations.ts";
import { bootEngine } from "./EngineBoot.ts";
import * as EngineSignalsModule from "./EngineSignals.ts";
import * as EffectsModule from "./effects/index.ts";
import { importOrSayGap } from "./effects/historyImport.ts";
import { AgentWorkspace, MessagePictures } from "./ports.ts";
import * as LiveBusModule from "./LiveBus.ts";
import {
  DeliveryUnrecorded,
  EventsUnreadable,
  MateEngine,
  ViewUnreadable,
  WakeRefused,
  type MateEngineService,
} from "./MateEngine.ts";
import { readConversationView, readConversationViews } from "./read/conversationView.ts";
import * as EffectOutboxModule from "./outbox/EffectOutbox.ts";
import type { EffectWorkerOptions } from "./outbox/EffectWorker.ts";
import * as TurnPumpModule from "./pump/TurnPump.ts";
import * as EngineStoreModule from "./store/EngineStore.ts";
import { runEngineMigrations } from "./store/migrations.ts";
import { makeEngineWire, type EngineWireOptions } from "./wire/EngineWire.ts";

const ENGINE = { kind: "engine" } as const;

const decodeAgent = Schema.decodeUnknownEffect(Schema.fromJsonString(ConversationAgent));
const decodeEnd = Schema.decodeUnknownEffect(Schema.fromJsonString(RunEnd));
const decodeSource = Schema.decodeUnknownEffect(RunEndSource);

interface CallDataRow {
  readonly item_id: string;
  readonly data_json: string;
  readonly at: number;
  readonly body_json: string;
}

interface RunEndRow {
  readonly run_id: string;
  readonly end_json: string | null;
  readonly end_source: string | null;
  readonly started_at: number | null;
}

export interface LiveEngineOptions {
  readonly worker?: EffectWorkerOptions;
  readonly conversations?: ConversationsModule.ConversationsOptions;
  readonly wire?: EngineWireOptions;
}

export const makeLiveMateEngine = (options: LiveEngineOptions = {}) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const signals = yield* EngineSignalsModule.EngineSignals;
    const live = yield* LiveBusModule.LiveBus;
    const sql = yield* SqlClient.SqlClient;
    const context = yield* Effect.context<
      | TurnPumpModule.TurnPump
      | Conversations
      | EffectOutboxModule.EffectOutbox
      | import("./outbox/EffectWorker.ts").EffectHandlers
      | EngineSignalsModule.EngineSignals
      | import("./ports.ts").RestartEvidence
      | SqlClient.SqlClient
    >();

    const start: MateEngineService["start"] = () =>
      Effect.gen(function* () {
        const bootId = BootId.make(
          `boot-${yield* Clock.currentTimeMillis}-${yield* Random.nextIntBetween(0, 1_000_000)}`,
        );
        const report = yield* bootEngine(
          bootId,
          options.worker === undefined ? {} : { worker: options.worker },
        );
        yield* Effect.logInfo("Mate engine: on", report);
      }).pipe(
        Effect.provide(context),
        Effect.catchCause((cause) => Effect.logError("Mate engine: the boot failed", cause)),
      );

    const stopSessionsOn: MateEngineService["stopSessionsOn"] = (instanceIds) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const rows = yield* sql<{ readonly conversation_id: string; readonly agent_json: string }>`
          SELECT conversation_id, agent_json FROM engine_conversation WHERE agent_json IS NOT NULL
        `;
        for (const row of rows) {
          const agent = yield* decodeAgent(row.agent_json).pipe(Effect.option);
          if (agent._tag === "None" || !instanceIds.includes(agent.value.instanceId)) continue;
          const conversation = ConversationId.make(row.conversation_id);
          yield* conversations.tell({
            commandId: CommandId.make(`sign-out:${conversation}:${now}`),
            conversationId: conversation,
            principal: ENGINE,
            command: { _tag: "CloseSession", reason: "signed-out" },
          });
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Mate engine: a sign-out could not close every session", cause),
        ),
      );

    const wake: MateEngineService["wake"] = (request) =>
      conversations
        .ask({
          commandId: CommandId.make(
            `wake:${request.kind}:${request.key}:${request.dueAt ?? request.cron ?? "now"}`,
          ),
          conversationId: request.conversationId,
          principal: request.principal,
          command: {
            _tag: "ArmWake",
            kind: request.kind,
            key: request.key,
            text: request.text,
            ...(request.dueAt === undefined ? {} : { dueAt: request.dueAt }),
            ...(request.cron === undefined ? {} : { cron: request.cron }),
            ...(request.joins === undefined ? {} : { joins: request.joins }),
          },
        })
        .pipe(
          Effect.flatMap((accepted) =>
            accepted.wakeId === undefined
              ? Effect.fail(new WakeRefused({ message: "The engine armed no wake." }))
              : Effect.succeed({ wakeId: accepted.wakeId }),
          ),
          Effect.catchTags({
            CommandRejected: (rejected) =>
              Effect.fail(
                new WakeRefused({
                  message:
                    rejected.rejection.detail ??
                    `The wake was refused (${String(rejected.rejection.reason)}).`,
                }),
              ),
          }),
          Effect.catchTags({
            EngineStoreError: () =>
              Effect.fail(new WakeRefused({ message: "The engine could not record the wake." })),
            EngineDecideFailed: () =>
              Effect.fail(new WakeRefused({ message: "The engine could not record the wake." })),
          }),
        );

    const runOutcome: MateEngineService["runOutcome"] = (wakeId) =>
      sql<{ readonly run_id: string; readonly end_json: string; readonly end_source: string }>`
        SELECT run_id, end_json, end_source FROM engine_run
        WHERE json_extract(trigger_json, '$.wakeId') = ${wakeId} AND end_json IS NOT NULL
        ORDER BY ordinal DESC LIMIT 1
      `.pipe(
        Effect.flatMap((rows) => {
          const row = rows[0];
          if (row === undefined) return Effect.succeed(undefined);
          return Effect.all({
            end: decodeEnd(row.end_json),
            source: decodeSource(row.end_source),
          }).pipe(
            Effect.map(({ end, source }) => ({
              wakeId,
              runId: RunId.make(row.run_id),
              end,
              source,
            })),
          );
        }),
        Effect.orElseSucceed(() => undefined),
      );

    const assignAgent: MateEngineService["assignAgent"] = (conversationId, agent) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* conversations.ask({
          commandId: CommandId.make(`assign:${agent.instanceId}:${now}`),
          conversationId,
          principal: ENGINE,
          command: { _tag: "AssignAgent", agent },
        });
        return true;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Mate engine: an agent could not be given", cause).pipe(
            Effect.as(false),
          ),
        ),
      );

    const importHistory: MateEngineService["importHistory"] = (conversationId, source) =>
      importOrSayGap(conversationId, source).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(Conversations, conversations),
        Effect.catchCause((cause) =>
          Effect.logWarning(
            "Mate engine: the earlier conversation's gap could not be said",
            cause,
          ).pipe(Effect.as(0)),
        ),
      );

    const callProgress: MateEngineService["callProgress"] = (providerThread, toolName, progress) =>
      Effect.gen(function* () {
        const conversation = TurnPumpModule.conversationOfThread(providerThread);
        if (conversation === undefined) return;
        // Progress goes onto the call while it runs; it is cleared (`null`) from the latest such
        // call whatever its state, since the record may have closed it first.
        const [call] = yield* sql<{ readonly item_id: string }>`
          SELECT item_id FROM engine_item
          WHERE conversation_id = ${conversation} AND kind = 'call'
            ${progress === null ? sql`` : sql`AND state = 'open'`}
            AND json_extract(body_json, '$.tool.name') = ${toolName}
          ORDER BY opened_seq DESC LIMIT 1
        `;
        if (call === undefined) return;
        yield* live.progress(conversation, call.item_id, progress);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Mate engine: a call's progress could not be shown", cause),
        ),
      );

    const callData: MateEngineService["callData"] = (conversationId, find) =>
      ("itemIds" in find
        ? find.itemIds.length === 0
          ? Effect.succeed<ReadonlyArray<CallDataRow>>([])
          : sql<CallDataRow>`
              SELECT d.item_id, d.data_json, d.at, i.body_json FROM engine_item_data d
              JOIN engine_item i ON i.item_id = d.item_id
              WHERE d.conversation_id = ${conversationId} AND ${sql.in("d.item_id", find.itemIds)}
              ORDER BY i.opened_seq
            `
        : // Only the records whose stored text holds the text, as JSON writes it: a scan of
          // the bytes, never a parse of every record.
          sql<CallDataRow>`
            SELECT d.item_id, d.data_json, d.at, i.body_json FROM engine_item_data d
            JOIN engine_item i ON i.item_id = d.item_id
            WHERE d.conversation_id = ${conversationId}
              AND instr(d.data_json, ${JSON.stringify(find.naming).slice(1, -1)}) > 0
            ORDER BY i.opened_seq
          `
      ).pipe(
        Effect.map((rows) =>
          rows.map((row) => {
            const body = JSON.parse(row.body_json) as { readonly state?: unknown };
            return {
              itemId: row.item_id,
              state: typeof body.state === "string" ? body.state : "unknown",
              at: row.at,
              data: JSON.parse(row.data_json) as unknown,
            };
          }),
        ),
        Effect.orElseSucceed(() => []),
      );

    /**
     * Whether a run's words reached the agent: it started; or no send of it was ever tried, or
     * every one was refused undelivered (provably never); else a send may have arrived.
     */
    const reachedAgent = (row: RunEndRow) =>
      row.started_at !== null
        ? Effect.succeed<boolean | "unknown">(true)
        : sql<{ readonly state: string; readonly outcome_json: string | null }>`
            SELECT state, outcome_json FROM engine_effect
            WHERE run_id = ${row.run_id} AND kind = 'provider.send'
          `.pipe(
            Effect.map((sends): boolean | "unknown" =>
              sends.every((send) => {
                // A send not settled, cut by a restart or closed mid-way may have arrived.
                if (send.outcome_json === null) return false;
                const outcome = JSON.parse(send.outcome_json) as {
                  readonly kind?: unknown;
                  readonly undelivered?: unknown;
                };
                // As decide reads it: a failed send that names no doubt was refused.
                return (
                  outcome.kind === "failed" &&
                  (outcome.undelivered === true || outcome.undelivered === undefined)
                );
              })
                ? false
                : "unknown",
            ),
          );

    const runOf: MateEngineService["runOf"] = (find) =>
      ("wakeId" in find
        ? sql<RunEndRow>`
            SELECT run_id, end_json, end_source, started_at FROM engine_run
            WHERE json_extract(trigger_json, '$.wakeId') = ${find.wakeId}
            ORDER BY ordinal DESC LIMIT 1
          `
        : sql<RunEndRow>`
            SELECT run_id, end_json, end_source, started_at FROM engine_run
            WHERE provider_turn_id = ${find.providerTurnId}
            ORDER BY ordinal DESC LIMIT 1
          `
      ).pipe(
        Effect.flatMap((rows) => {
          const row = rows[0];
          if (row === undefined) return Effect.succeed(undefined);
          return Effect.all({
            end: row.end_json === null ? Effect.succeed(null) : decodeEnd(row.end_json),
            source: row.end_source === null ? Effect.succeed(null) : decodeSource(row.end_source),
            reachedAgent: reachedAgent(row),
          }).pipe(
            Effect.map(({ end, source, reachedAgent }) => ({
              runId: RunId.make(row.run_id),
              end,
              source,
              reachedAgent,
            })),
          );
        }),
        Effect.orElseSucceed(() => undefined),
      );

    const store = yield* EngineStoreModule.EngineStore;
    const workspace = yield* AgentWorkspace;

    const deliver: MateEngineService["deliver"] = (conversationId, command, commandId, principal) =>
      conversations
        .tell({ commandId, conversationId, principal, command })
        .pipe(
          Effect.mapError(
            (error) => new DeliveryUnrecorded({ conversationId, message: error.message }),
          ),
        );

    const eventsAfter: MateEngineService["eventsAfter"] = (conversationId, afterSeq, limit) =>
      store
        .events(conversationId, afterSeq, limit)
        .pipe(Effect.mapError(() => new EventsUnreadable({ conversationId })));

    // Open unless a flipped Mate holds its people's sends until its main conversation is adopted.
    const sends = yield* Latch.make(true);
    const wire = yield* makeEngineWire({
      ...options.wire,
      sendsWait: sends.await,
      pictures: yield* MessagePictures,
    });
    const updateDrain = yield* makeEngineUpdateDrain;

    return MateEngine.of({
      live: true,
      ...(updateDrain === undefined ? {} : { updateDrain }),
      wire,
      holdSends: Effect.as(sends.close, Effect.asVoid(sends.open)),
      start,
      conversations: readConversationViews.pipe(
        Effect.provideService(Conversations, conversations),
        Effect.provideService(SqlClient.SqlClient, sql),
        // The listing itself failed: nothing is known, nothing is "none".
        Effect.catchCause((cause) =>
          Effect.logWarning("Mate engine: the conversations could not be listed", cause).pipe(
            Effect.as({ views: [], unread: [], complete: false }),
          ),
        ),
      ),
      assetContext: (thread) => {
        const id = TurnPumpModule.conversationOfThread(thread) ?? ConversationId.make(thread);
        return Effect.gen(function* () {
          const rows = yield* sql`
            SELECT 1 FROM engine_conversation
            WHERE conversation_id = ${id} AND owner_kind = 'conversation' LIMIT 1
          `;
          if (rows.length === 0) return undefined;
          return { workspaceRoot: (yield* workspace.of(id)).cwd };
        }).pipe(Effect.mapError(() => new ViewUnreadable({ conversationId: id })));
      },
      conversation: (id) =>
        readConversationView(id).pipe(
          Effect.provideService(Conversations, conversations),
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.catchCause((cause) =>
            Effect.logWarning("Mate engine: a view could not be read", cause).pipe(
              Effect.andThen(Effect.fail(new ViewUnreadable({ conversationId: id }))),
            ),
          ),
        ),
      changes: Stream.fromPubSub(signals.commits),
      stopSessionsOn,
      wake,
      runOutcome,
      assignAgent,
      importHistory,
      callProgress,
      callData,
      runOf,
      deliver,
      eventsAfter,
      owner: (domain) => Option.some(conversations.owner(domain)),
      generation: (conversationId) =>
        conversations.state(conversationId).pipe(
          Effect.map((state) => state.threadGeneration),
          Effect.orElseSucceed(() => undefined),
        ),
    });
  });

/**
 * The engine's runtime on the server's SQLite, its own migrations first. It needs the provider
 * (ProviderService and the SPI bus), the workspace history and the ports.
 */
export const engineRuntimeLayer = (options: LiveEngineOptions = {}) =>
  EffectsModule.layer.pipe(
    Layer.provideMerge(TurnPumpModule.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        ConversationsModule.layer(options.conversations),
        EffectOutboxModule.layer,
        LiveBusModule.layer,
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(EngineStoreModule.layer, EngineSignalsModule.layer)),
    // The engine cannot run on tables it could not migrate: the server stops there.
    Layer.provideMerge(Layer.orDie(Layer.effectDiscard(runEngineMigrations()))),
  );

/** The live `MateEngine` over its runtime. */
export const liveEngineLayer = (options: LiveEngineOptions = {}) =>
  Layer.effect(MateEngine, makeLiveMateEngine(options)).pipe(
    Layer.provideMerge(engineRuntimeLayer(options)),
  );
