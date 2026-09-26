import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ThreadUsagePause,
} from "@t3tools/contracts";
import { USAGE_LIMIT_RESUME_PROMPT } from "@t3tools/shared/userAsk";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ServerConfig } from "../../config.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ThreadUsagePauseReactor } from "../Services/ThreadUsagePauseReactor.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { USAGE_RESUME_GRACE_MS } from "../usagePause.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ThreadUsagePauseReactorLive } from "./ThreadUsagePauseReactor.ts";

const NOW = "2026-09-26T09:00:00.000Z";
const RESETS_AT = "2026-09-26T13:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-usage-pause");
const UNTIL_RESET = Duration.millis(Date.parse(RESETS_AT) - Date.parse(NOW));

const makeHarness = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
  );
  const snapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
  );
  const layer = ThreadUsagePauseReactorLive.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(snapshotLayer),
    Layer.provideMerge(Layer.mock(ProviderService)({ streamEvents: Stream.fromPubSub(events) })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-usage-pause-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  return { events, layer };
});

const blockedEvent = (resetsAt: string): ProviderRuntimeEvent => ({
  type: "account.rate-limits.updated",
  eventId: EventId.make(`event-blocked-${resetsAt}`),
  provider: ProviderDriverKind.make("claudeAgent"),
  threadId: THREAD_ID,
  createdAt: NOW,
  payload: { limits: { windows: [] }, blocked: { window: "5-hour", resetsAt } },
});

const taskCompleted = (input: {
  readonly taskId: string;
  readonly status: "completed" | "failed" | "stopped";
  readonly turnId?: string;
}): ProviderRuntimeEvent => ({
  type: "task.completed",
  eventId: EventId.make(`event-task-${input.taskId}`),
  provider: ProviderDriverKind.make("claudeAgent"),
  threadId: THREAD_ID,
  createdAt: NOW,
  ...(input.turnId ? { turnId: TurnId.make(input.turnId) } : {}),
  payload: { taskId: input.taskId as never, status: input.status },
});

const turnCompleted = (state: "completed" | "failed"): ProviderRuntimeEvent => ({
  type: "turn.completed",
  eventId: EventId.make(`event-turn-${state}`),
  provider: ProviderDriverKind.make("claudeAgent"),
  threadId: THREAD_ID,
  createdAt: NOW,
  turnId: TurnId.make(`turn-${state}`),
  payload: { state },
});

interface ReactorTestContext {
  readonly publish: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly settle: Effect.Effect<void>;
  readonly pause: Effect.Effect<ThreadUsagePause | null, ProjectionRepositoryError>;
  readonly userMessages: Effect.Effect<ReadonlyArray<string>, ProjectionRepositoryError>;
  readonly engine: OrchestrationEngineService["Service"];
  readonly startReactor: Effect.Effect<void>;
}

/**
 * Runs `body` against a fresh engine with one thread, the reactor started, and
 * the test clock at NOW. `settle` lets the event subscriber hand everything
 * published so far to the reactor and waits for it.
 */
const withReactor = <A, E>(
  body: (context: ReactorTestContext) => Effect.Effect<A, E>,
  options: { readonly startFirst?: boolean } = {},
) =>
  Effect.gen(function* () {
    const { events, layer } = yield* makeHarness;
    return yield* Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const scope = yield* Effect.scope;
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const reactor = yield* ThreadUsagePauseReactor;
      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project"),
        projectId: ProjectId.make("project-usage-pause"),
        title: "Usage pause",
        workspaceRoot: "/tmp/usage-pause",
        defaultModelSelection: null,
        createdAt: NOW,
      });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread"),
        threadId: THREAD_ID,
        projectId: ProjectId.make("project-usage-pause"),
        title: "Lena",
        modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: NOW,
      });
      const settle = Effect.gen(function* () {
        for (let index = 0; index < 50; index += 1) yield* Effect.yieldNow;
        yield* reactor.drain;
      });
      const startReactor = reactor.start().pipe(Scope.provide(scope), Effect.andThen(settle));
      if (options.startFirst !== false) yield* startReactor;
      return yield* body({
        publish: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
        settle,
        pause: snapshotQuery
          .getThreadShellById(THREAD_ID)
          .pipe(Effect.map((shell) => Option.getOrUndefined(shell)?.usagePause ?? null)),
        userMessages: snapshotQuery.getThreadDetailById(THREAD_ID).pipe(
          Effect.map((thread) =>
            Option.match(thread, {
              onNone: () => [],
              onSome: (detail) =>
                detail.messages
                  .filter((message) => message.role === "user")
                  .map((message) => message.text),
            }),
          ),
        ),
        engine,
        startReactor,
      });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()));

describe("ThreadUsagePauseReactor", () => {
  it.effect("pauses once for a blocked window and counts the background results it holds", () =>
    withReactor(({ publish, settle, pause }) =>
      Effect.gen(function* () {
        yield* publish(blockedEvent(RESETS_AT));
        yield* publish(blockedEvent(RESETS_AT));
        yield* settle;
        assert.deepStrictEqual(yield* pause, {
          resetsAt: RESETS_AT,
          window: "5-hour",
          held: 0,
          pausedAt: NOW,
          autoResume: true,
        });

        for (const event of [
          taskCompleted({ taskId: "agent-1", status: "completed" }),
          taskCompleted({ taskId: "agent-2", status: "failed" }),
          // Neither is a result that would have woken the thread.
          taskCompleted({ taskId: "agent-3", status: "completed", turnId: "turn-running" }),
          taskCompleted({ taskId: "agent-4", status: "stopped" }),
        ]) {
          yield* publish(event);
        }
        yield* settle;
        assert.strictEqual((yield* pause)?.held, 2);
      }),
    ),
  );

  it.effect("does not pause for a blocked window whose reset already passed", () =>
    withReactor(({ publish, settle, pause }) =>
      Effect.gen(function* () {
        yield* publish(blockedEvent("2026-09-26T08:59:00.000Z"));
        yield* publish(taskCompleted({ taskId: "agent-1", status: "completed" }));
        yield* settle;
        assert.strictEqual(yield* pause, null);
      }),
    ),
  );

  it.effect("resumes the thread's work itself at the reset and its grace, not before", () =>
    withReactor(({ publish, settle, pause, userMessages }) =>
      Effect.gen(function* () {
        yield* publish(blockedEvent(RESETS_AT));
        yield* settle;

        yield* TestClock.adjust(UNTIL_RESET);
        yield* settle;
        assert.notStrictEqual(yield* pause, null);
        assert.deepStrictEqual(yield* userMessages, []);

        yield* TestClock.adjust(Duration.millis(USAGE_RESUME_GRACE_MS));
        yield* settle;
        assert.strictEqual(yield* pause, null);
        assert.deepStrictEqual(yield* userMessages, [USAGE_LIMIT_RESUME_PROMPT]);
      }),
    ),
  );

  it.effect.each([
    {
      name: "the person turned auto-resume off",
      arrange: (engine: OrchestrationEngineService["Service"]) =>
        engine.dispatch({
          type: "thread.usage-auto-resume.set",
          commandId: CommandId.make("cmd-auto-resume-off"),
          threadId: THREAD_ID,
          enabled: false,
        }),
    },
    {
      name: "a turn is still running",
      arrange: (engine: OrchestrationEngineService["Service"]) =>
        engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-running"),
          threadId: THREAD_ID,
          session: {
            threadId: THREAD_ID,
            status: "running",
            providerName: "claudeAgent",
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("turn-parked"),
            lastError: null,
            updatedAt: NOW,
          },
          createdAt: NOW,
        }),
    },
  ])("clears the pause at the reset without resuming when $name", ({ arrange }) =>
    withReactor(({ publish, settle, pause, userMessages, engine }) =>
      Effect.gen(function* () {
        yield* publish(blockedEvent(RESETS_AT));
        yield* settle;
        yield* arrange(engine);

        yield* TestClock.adjust(Duration.sum(UNTIL_RESET, Duration.millis(USAGE_RESUME_GRACE_MS)));
        yield* settle;
        assert.strictEqual(yield* pause, null);
        assert.deepStrictEqual(yield* userMessages, []);
      }),
    ),
  );

  it.effect("lifts the pause when a turn completes, and the old reset then does nothing", () =>
    withReactor(({ publish, settle, pause, userMessages }) =>
      Effect.gen(function* () {
        yield* publish(blockedEvent(RESETS_AT));
        yield* settle;
        yield* publish(turnCompleted("failed"));
        yield* settle;
        assert.notStrictEqual(yield* pause, null);

        yield* publish(turnCompleted("completed"));
        yield* settle;
        assert.strictEqual(yield* pause, null);

        yield* TestClock.adjust(Duration.sum(UNTIL_RESET, Duration.millis(USAGE_RESUME_GRACE_MS)));
        yield* settle;
        assert.deepStrictEqual(yield* userMessages, []);
      }),
    ),
  );

  it.effect(
    "re-arms a pause that outlived a restart and resumes at once when its reset passed",
    () =>
      withReactor(
        ({ engine, settle, pause, userMessages, startReactor }) =>
          Effect.gen(function* () {
            yield* engine.dispatch({
              type: "thread.usage-pause.set",
              commandId: CommandId.make("server:usage-pause:before-restart"),
              threadId: THREAD_ID,
              usagePause: {
                resetsAt: "2026-09-26T08:00:00.000Z",
                window: "5-hour",
                held: 4,
                pausedAt: "2026-09-26T04:00:00.000Z",
              },
              createdAt: "2026-09-26T04:00:00.000Z",
            });

            yield* startReactor;
            yield* settle;
            assert.strictEqual(yield* pause, null);
            assert.deepStrictEqual(yield* userMessages, [USAGE_LIMIT_RESUME_PROMPT]);
          }),
        { startFirst: false },
      ),
  );
});
