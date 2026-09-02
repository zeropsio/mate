import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_MODEL,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "./config.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "./provider/Services/ProviderRegistry.ts";
import * as AnalyticsService from "./telemetry/AnalyticsService.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import { resolveZeropsEnvironment } from "./zerops/ZeropsEnvironment.ts";

it("uses the canonical Codex default for auto-bootstrapped model selection", () => {
  assert.deepStrictEqual(ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection(), {
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  });
});

it.effect("enqueueCommand waits for readiness and then drains queued work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const executionCount = yield* Ref.make(0);
      const commandGate = yield* ServerRuntimeStartup.makeCommandGate;

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Ref.updateAndGet(executionCount, (count) => count + 1))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      assert.equal(yield* Ref.get(executionCount), 0);

      yield* commandGate.signalCommandReady;

      const result = yield* Fiber.join(queuedCommandFiber);
      assert.equal(result, 1);
      assert.equal(yield* Ref.get(executionCount), 1);
    }),
  ),
);

it.effect("enqueueCommand fails queued work when readiness fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commandGate = yield* ServerRuntimeStartup.makeCommandGate;
      const failure = yield* Deferred.make<void, never>();

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Deferred.await(failure).pipe(Effect.as("should-not-run")))
        .pipe(Effect.forkScoped);

      yield* commandGate.failCommandReady(
        new ServerRuntimeStartup.ServerRuntimeStartupError({
          mode: "web",
          host: "127.0.0.1",
          port: 3773,
          cause: new Error("test startup failure"),
        }),
      );

      const error = yield* Effect.flip(Fiber.join(queuedCommandFiber));
      assert.equal(error.message, "Server runtime startup failed before command readiness.");
    }),
  ),
);

it.effect("launchStartupHeartbeat does not block the caller while counts are loading", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const releaseCounts = yield* Deferred.make<void, never>();

      yield* ServerRuntimeStartup.launchStartupHeartbeat.pipe(
        Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
          getCommandReadModel: () => Effect.die("unused"),
          getSnapshot: () => Effect.die("unused"),
          getShellSnapshot: () => Effect.die("unused"),
          getArchivedShellSnapshot: () => Effect.die("unused"),
          getSnapshotSequence: () => Effect.die("unused"),
          getEventReplayStats: () => Effect.die("unused"),
          getCounts: () =>
            Deferred.await(releaseCounts).pipe(
              Effect.as({
                projectCount: 2,
                threadCount: 3,
              }),
            ),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () => Effect.succeed(Option.none()),
          getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
          getThreadCheckpointContext: () => Effect.succeed(Option.none()),
          getFullThreadDiffContext: () => Effect.succeed(Option.none()),
          getThreadShellById: () => Effect.succeed(Option.none()),
          getThreadDetailById: () => Effect.succeed(Option.none()),
          getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
          searchThreads: () => Effect.succeed({ matches: [] }),
        }),
        Effect.provideService(AnalyticsService.AnalyticsService, {
          record: () => Effect.void,
          flush: Effect.void,
        }),
      );
    }),
  ),
);

it.effect("resolveWelcomeBase derives cwd and project name from server config", () =>
  Effect.gen(function* () {
    const welcome = yield* ServerRuntimeStartup.resolveWelcomeBase.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
      } as never),
    );

    assert.deepStrictEqual(welcome, {
      cwd: "/tmp/startup-project",
      projectName: "startup-project",
    });
  }),
);

it.effect("resolveAutoBootstrapWelcomeTargets returns existing project and thread ids", () => {
  const bootstrapProjectId = ProjectId.make("project-startup-bootstrap");
  const bootstrapThreadId = ThreadId.make("thread-startup-bootstrap");

  return Effect.gen(function* () {
    const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);
    const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getEventReplayStats: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () =>
          Effect.succeed(
            Option.some({
              id: bootstrapProjectId,
              title: "Startup Project",
              workspaceRoot: "/tmp/startup-project",
              defaultModelSelection: ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection(),
              scripts: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            }),
          ),
        getProjectShellById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.some(bootstrapThreadId)),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getFullThreadDiffContext: () => Effect.succeed(Option.none()),
        getThreadShellById: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshot: () => Effect.die("unused"),
        searchThreads: () => Effect.succeed({ matches: [] }),
      }),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        latestSequence: Effect.succeed(0),
      } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provide(NodeServices.layer),
    );

    assert.deepStrictEqual(targets, {
      bootstrapProjectId,
      bootstrapThreadId,
    });
    assert.deepStrictEqual(yield* Ref.get(dispatchCalls), []);
  });
});

it.effect("resolveAutoBootstrapWelcomeTargets creates a project and thread when missing", () =>
  Effect.gen(function* () {
    const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);
    const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getEventReplayStats: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
        getProjectShellById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getFullThreadDiffContext: () => Effect.succeed(Option.none()),
        getThreadShellById: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshot: () => Effect.die("unused"),
        searchThreads: () => Effect.succeed({ matches: [] }),
      }),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        latestSequence: Effect.succeed(0),
      } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provide(NodeServices.layer),
    );

    assert.equal(typeof targets.bootstrapProjectId, "string");
    assert.equal(typeof targets.bootstrapThreadId, "string");
    assert.deepStrictEqual(yield* Ref.get(dispatchCalls), ["project.create", "thread.create"]);
  }),
);

it.effect("resolveAutoBootstrapWelcomeTargets preserves typed UUID generation failures", () =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const uuidError = PlatformError.systemError({
      _tag: "Unknown",
      module: "Crypto",
      method: "randomUUIDv4",
      description: "UUID generation unavailable",
    });
    const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);

    const error = yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getEventReplayStats: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
        getProjectShellById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getFullThreadDiffContext: () => Effect.succeed(Option.none()),
        getThreadShellById: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshot: () => Effect.die("unused"),
        searchThreads: () => Effect.succeed({ matches: [] }),
      }),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        latestSequence: Effect.succeed(0),
      } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provideService(Crypto.Crypto, {
        ...crypto,
        randomUUIDv4: Effect.fail(uuidError),
      }),
      Effect.flip,
    );

    assert.strictEqual(error, uuidError);
    assert.deepStrictEqual(yield* Ref.get(dispatchCalls), []);
  }).pipe(Effect.provide(NodeServices.layer)),
);

// --- Zerops container: the bootstrap thread opens on an authenticated provider ---

const zeropsEnvironment = resolveZeropsEnvironment({
  projectId: "nTV3oMB2SS634ImDJnQckg",
  apiHost: undefined,
  allowedOrigins: [],
  membershipTtlSeconds: undefined,
});

const bootstrapSnapshotQuery = (
  existingProject: Option.Option<{ readonly defaultModelSelection: unknown }>,
) =>
  ({
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () =>
      Effect.succeed(
        Option.map(existingProject, (project) => ({
          id: ProjectId.make("project-startup-bootstrap"),
          title: "Startup Project",
          workspaceRoot: "/tmp/startup-project",
          scripts: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
          ...project,
        })),
      ),
    getProjectShellById: () => Effect.die("unused"),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getFullThreadDiffContext: () => Effect.succeed(Option.none()),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
    getThreadDetailSnapshot: () => Effect.die("unused"),
    searchThreads: () => Effect.succeed({ matches: [] }),
  }) as never;

const providerSnapshot = (
  overrides: Partial<ServerProvider> & Pick<ServerProvider, "driver">,
): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(overrides.driver),
    displayName: overrides.driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [{ slug: "model-a", name: "Model A", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
    ...overrides,
  }) satisfies ServerProvider;

const READY_CLAUDE = providerSnapshot({
  driver: ProviderDriverKind.make("claudeAgent"),
  models: [{ slug: "claude-sonnet-5", name: "Sonnet 5", isCustom: false, capabilities: null }],
});

const UNAUTHENTICATED_CODEX = providerSnapshot({
  driver: ProviderDriverKind.make("codex"),
  status: "error",
  auth: { status: "unauthenticated" },
  models: [{ slug: DEFAULT_MODEL, name: "GPT", isCustom: false, capabilities: null }],
});

const runBootstrap = (input: {
  readonly zerops: boolean;
  readonly providers?: ReadonlyArray<ServerProvider>;
  /** Overrides `providers` when the registry must answer differently per call. */
  readonly getProviders?: Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly existingProject?: Option.Option<{ readonly defaultModelSelection: unknown }>;
}) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
    yield* ServerRuntimeStartup.resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provideService(ServerConfig.ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
        ...(input.zerops ? { zerops: zeropsEnvironment } : {}),
      } as never),
      Effect.provideService(
        ProjectionSnapshotQuery.ProjectionSnapshotQuery,
        bootstrapSnapshotQuery(input.existingProject ?? Option.none()),
      ),
      Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch: (command) =>
          Ref.update(dispatched, (calls) => [
            ...calls,
            command as unknown as Record<string, unknown>,
          ]).pipe(Effect.as({ sequence: 1 })),
        streamDomainEvents: Stream.empty,
        subscribeDomainEvents: Effect.succeed(Stream.empty),
        latestSequence: Effect.succeed(0),
      } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
      Effect.provideService(ProviderRegistry.ProviderRegistry, {
        getProviders: input.getProviders ?? Effect.succeed(input.providers ?? []),
      } as never),
      Effect.provide(NodeServices.layer),
    );
    return yield* Ref.get(dispatched);
  });

it.effect(
  "auto-bootstrap on Zerops opens the first thread on the authenticated provider, not Codex",
  () =>
    Effect.gen(function* () {
      const dispatched = yield* runBootstrap({
        zerops: true,
        providers: [UNAUTHENTICATED_CODEX, READY_CLAUDE],
      });

      const expected = {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-5",
      };
      assert.deepStrictEqual(
        dispatched.map((command) => command.type),
        ["project.create", "thread.create"],
      );
      assert.deepStrictEqual(dispatched[0]?.defaultModelSelection, expected);
      assert.deepStrictEqual(dispatched[1]?.modelSelection, expected);
    }),
);

it.effect("auto-bootstrap outside a Zerops container keeps the upstream Codex default", () =>
  Effect.gen(function* () {
    const dispatched = yield* runBootstrap({
      zerops: false,
      providers: [UNAUTHENTICATED_CODEX, READY_CLAUDE],
    });

    const expected = ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection();
    assert.deepStrictEqual(dispatched[0]?.defaultModelSelection, expected);
    assert.deepStrictEqual(dispatched[1]?.modelSelection, expected);
  }),
);

it.effect("auto-bootstrap on Zerops keeps the upstream default when no provider is ready", () =>
  Effect.gen(function* () {
    const dispatched = yield* runBootstrap({
      zerops: true,
      providers: [UNAUTHENTICATED_CODEX],
    });

    const expected = ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection();
    assert.deepStrictEqual(dispatched[0]?.defaultModelSelection, expected);
    assert.deepStrictEqual(dispatched[1]?.modelSelection, expected);
  }),
);

it.effect(
  "an existing project without a stored default gets the resolved Zerops selection for its first thread",
  () =>
    Effect.gen(function* () {
      const dispatched = yield* runBootstrap({
        zerops: true,
        providers: [UNAUTHENTICATED_CODEX, READY_CLAUDE],
        existingProject: Option.some({ defaultModelSelection: null }),
      });

      assert.deepStrictEqual(
        dispatched.map((command) => command.type),
        ["thread.create"],
      );
      assert.deepStrictEqual(dispatched[0]?.modelSelection, {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-5",
      });
    }),
);

it.effect("an existing project's stored default still wins on Zerops", () =>
  Effect.gen(function* () {
    const stored = { instanceId: ProviderInstanceId.make("codex"), model: DEFAULT_MODEL };
    const dispatched = yield* runBootstrap({
      zerops: true,
      providers: [UNAUTHENTICATED_CODEX, READY_CLAUDE],
      existingProject: Option.some({ defaultModelSelection: stored }),
    });

    assert.deepStrictEqual(dispatched[0]?.modelSelection, stored);
  }),
);

// --- Zerops container: the bootstrap waits for the first provider probe ---

/** A provider whose very first probe has not landed yet. */
const probing = (snapshot: ServerProvider): ServerProvider => ({
  ...snapshot,
  installed: false,
  status: "warning",
  auth: { status: "unknown" },
});

/**
 * A registry that answers with still-probing snapshots for the first
 * `pendingCalls` reads and settled ones after that — the shape of a real boot,
 * where the managed snapshot is published synchronously and the CLI probe
 * lands seconds later.
 */
const flippingRegistry = (input: {
  readonly pendingCalls: number;
  readonly pending: ReadonlyArray<ServerProvider>;
  readonly settled: ReadonlyArray<ServerProvider>;
}) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    return {
      calls,
      getProviders: Ref.updateAndGet(calls, (count) => count + 1).pipe(
        Effect.map((count) => (count > input.pendingCalls ? input.settled : input.pending)),
      ),
    };
  });

it.effect("auto-bootstrap on Zerops waits for the first provider probe before choosing", () =>
  Effect.gen(function* () {
    const registry = yield* flippingRegistry({
      pendingCalls: 1,
      pending: [probing(UNAUTHENTICATED_CODEX), probing(READY_CLAUDE)],
      settled: [UNAUTHENTICATED_CODEX, READY_CLAUDE],
    });

    const fiber = yield* runBootstrap({
      zerops: true,
      getProviders: registry.getProviders,
    }).pipe(Effect.forkChild);

    yield* TestClock.adjust(ServerRuntimeStartup.ZEROPS_BOOTSTRAP_PROVIDER_POLL_INTERVAL);
    const dispatched = yield* Fiber.join(fiber);

    const expected = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-5",
    };
    assert.deepStrictEqual(dispatched[0]?.defaultModelSelection, expected);
    assert.deepStrictEqual(dispatched[1]?.modelSelection, expected);
    assert.isAbove(yield* Ref.get(registry.calls), 1);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("auto-bootstrap does not wait once every provider has settled", () =>
  Effect.gen(function* () {
    const registry = yield* flippingRegistry({
      pendingCalls: 0,
      pending: [],
      settled: [UNAUTHENTICATED_CODEX],
    });

    // No clock is advanced: a settled registry must decide on the first read,
    // so a container where nobody is signed in still gets its thread at once.
    const dispatched = yield* runBootstrap({
      zerops: true,
      getProviders: registry.getProviders,
    });

    assert.deepStrictEqual(
      dispatched[0]?.defaultModelSelection,
      ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection(),
    );
    assert.equal(yield* Ref.get(registry.calls), 1);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("auto-bootstrap gives up on a provider whose probe never lands", () =>
  Effect.gen(function* () {
    const registry = yield* flippingRegistry({
      pendingCalls: Number.MAX_SAFE_INTEGER,
      pending: [probing(READY_CLAUDE)],
      settled: [],
    });

    const fiber = yield* runBootstrap({
      zerops: true,
      getProviders: registry.getProviders,
    }).pipe(Effect.forkChild);

    yield* TestClock.adjust(ServerRuntimeStartup.ZEROPS_BOOTSTRAP_PROVIDER_WAIT);
    const dispatched = yield* Fiber.join(fiber);

    assert.deepStrictEqual(
      dispatched[0]?.defaultModelSelection,
      ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection(),
    );
    // It gave up on the deadline, not on the first read.
    assert.isAbove(yield* Ref.get(registry.calls), 1);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("auto-bootstrap outside a Zerops container never reads the provider registry", () =>
  Effect.gen(function* () {
    const registry = yield* flippingRegistry({
      pendingCalls: 0,
      pending: [],
      settled: [UNAUTHENTICATED_CODEX, READY_CLAUDE],
    });

    const dispatched = yield* runBootstrap({
      zerops: false,
      getProviders: registry.getProviders,
    });

    assert.deepStrictEqual(
      dispatched[0]?.defaultModelSelection,
      ServerRuntimeStartup.getAutoBootstrapDefaultModelSelection(),
    );
    assert.equal(yield* Ref.get(registry.calls), 0);
  }).pipe(Effect.provide(TestClock.layer())),
);
