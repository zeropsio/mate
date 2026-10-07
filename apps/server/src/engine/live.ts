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
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  BootId,
  CommandId,
  ConversationAgent,
  ConversationId,
  RunEnd,
  RunId,
  RunEndSource,
} from "@t3tools/contracts";

import * as ConversationsModule from "./Conversations.ts";
import { Conversations } from "./Conversations.ts";
import { bootEngine } from "./EngineBoot.ts";
import * as EngineSignalsModule from "./EngineSignals.ts";
import * as EffectsModule from "./effects/index.ts";
import * as LiveBusModule from "./LiveBus.ts";
import { MateEngine, WakeRefused, type MateEngineService } from "./MateEngine.ts";
import { readConversationView, readConversationViews } from "./read/conversationView.ts";
import * as EffectOutboxModule from "./outbox/EffectOutbox.ts";
import type { EffectWorkerOptions } from "./outbox/EffectWorker.ts";
import * as TurnPumpModule from "./pump/TurnPump.ts";
import * as EngineStoreModule from "./store/EngineStore.ts";
import { runEngineMigrations } from "./store/migrations.ts";

const ENGINE = { kind: "engine" } as const;

const decodeAgent = Schema.decodeUnknownEffect(Schema.fromJsonString(ConversationAgent));
const decodeEnd = Schema.decodeUnknownEffect(Schema.fromJsonString(RunEnd));
const decodeSource = Schema.decodeUnknownEffect(RunEndSource);

interface RunEndRow {
  readonly run_id: string;
  readonly end_json: string | null;
  readonly end_source: string | null;
}

export interface LiveEngineOptions {
  readonly worker?: EffectWorkerOptions;
  readonly conversations?: ConversationsModule.ConversationsOptions;
}

export const makeLiveMateEngine = (options: LiveEngineOptions = {}) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const signals = yield* EngineSignalsModule.EngineSignals;
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
          Effect.catchTag("CommandRejected", (rejected) =>
            Effect.fail(
              new WakeRefused({
                message:
                  rejected.rejection.detail ??
                  `The wake was refused (${String(rejected.rejection.reason)}).`,
              }),
            ),
          ),
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

    const runOf: MateEngineService["runOf"] = (find) =>
      ("wakeId" in find
        ? sql<RunEndRow>`
            SELECT run_id, end_json, end_source FROM engine_run
            WHERE json_extract(trigger_json, '$.wakeId') = ${find.wakeId}
            ORDER BY ordinal DESC LIMIT 1
          `
        : sql<RunEndRow>`
            SELECT run_id, end_json, end_source FROM engine_run
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
          }).pipe(
            Effect.map(({ end, source }) => ({ runId: RunId.make(row.run_id), end, source })),
          );
        }),
        Effect.orElseSucceed(() => undefined),
      );

    return MateEngine.of({
      live: true,
      start,
      conversations: readConversationViews.pipe(
        Effect.provideService(Conversations, conversations),
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.tapCause((cause) =>
          Effect.logWarning("Mate engine: a view could not be read", cause),
        ),
        Effect.orElseSucceed(() => []),
      ),
      conversation: (id) =>
        readConversationView(id).pipe(
          Effect.provideService(Conversations, conversations),
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.tapCause((cause) =>
            Effect.logWarning("Mate engine: a view could not be read", cause),
          ),
          Effect.orElseSucceed(() => undefined),
        ),
      changes: Stream.fromPubSub(signals.commits),
      stopSessionsOn,
      wake,
      runOutcome,
      assignAgent,
      runOf,
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
