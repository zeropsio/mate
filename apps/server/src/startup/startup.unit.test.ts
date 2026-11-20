import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { inertMateEngine } from "../engine/testing/inertEngine.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import {
  formatZeropsServeOutput,
  resolveHeadlessConnectionHost,
  resolveHeadlessConnectionString,
  resolveListeningPort,
} from "../startupAccess.ts";

// witness: apps/server/src/serverRuntimeStartup.ts |         if (readinessState === "ready") { →         if (readinessState === "ready" || readinessState === "pending") {
it.effect(
  "BT1: A command that arrives before the server is ready waits, and runs exactly once when readiness is signalled",
  () =>
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

// witness: apps/server/src/serverRuntimeStartup.ts |             Effect.flatMap(() => effect), →             Effect.ignore, Effect.flatMap(() => effect),
it.effect(
  "BT2: When the server fails to start, a command waiting for readiness fails with the startup error and never runs",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const commandGate = yield* ServerRuntimeStartup.makeCommandGate;
        const runs = yield* Ref.make(0);

        const queuedCommandFiber = yield* commandGate
          .enqueueCommand(Ref.update(runs, (count) => count + 1).pipe(Effect.as("should-not-run")))
          .pipe(Effect.forkScoped);
        // The command reaches the queue before the start fails, so it is waiting, not refused at once.
        yield* Effect.yieldNow;

        yield* commandGate.failCommandReady(
          new ServerRuntimeStartup.ServerRuntimeStartupError({
            mode: "web",
            host: "127.0.0.1",
            port: 3773,
            cause: new Error("test startup failure"),
          }),
        );

        const joined = yield* Effect.result(Fiber.join(queuedCommandFiber));
        assert.equal(
          Result.isFailure(joined) ? joined.failure._tag : undefined,
          "ServerRuntimeStartupError",
        );
        assert.equal(yield* Ref.get(runs), 0);
      }),
    ),
);

// witness: apps/server/src/serverRuntimeStartup.ts |   const projectName = segments[segments.length - 1] ?? "project"; →   const projectName = segments[0] ?? "project";
it.effect(
  "BT3: The welcome names the project after the last segment of the server's working directory",
  () =>
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

// witness: apps/server/src/serverRuntimeStartup.ts |   if (Option.isSome(existingProject)) return { bootstrapProjectId: existingProject.value.id }; →   if (Option.isSome(existingProject) && existingProject.value.deletedAt !== null) return { bootstrapProjectId: existingProject.value.id };
it.effect(
  "BT4: With auto-bootstrap on, the project already at the working directory is kept and nothing is dispatched",
  () => {
    const bootstrapProjectId = ProjectId.make("project-startup-bootstrap");

    return Effect.gen(function* () {
      const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);
      const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapProject.pipe(
        Effect.provideService(ServerConfig.ServerConfig, {
          cwd: "/tmp/startup-project",
          autoBootstrapProjectFromCwd: true,
        } as never),
        Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
          getUserInputActivity: () => Effect.die("unused"),
          getTurnStartMessage: () => Effect.die("unused"),
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
                defaultModelSelection: null,
                scripts: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                deletedAt: null,
              }),
            ),
          getProjectWorkspaceRootById: () => Effect.die("unused"),
          getProjectShellById: () => Effect.die("unused"),
          getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
          getThreadRuntimeContext: () => Effect.die("unused"),
          getThreadShellById: () => Effect.die("unused"),
          getThreadDetailById: () => Effect.die("unused"),
          getThreadDetailSnapshot: () => Effect.die("unused"),
          searchThreads: () => Effect.succeed({ matches: [] }),
        }),
        Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          readThreadEvents: () => Stream.empty,
          getThreadReplayStats: () => Effect.die("unused thread replay stats"),
          dispatch: (command) =>
            Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
              Effect.as({ sequence: 1 }),
            ),
          streamDomainEvents: Stream.empty,
          subscribeDomainEvents: Effect.succeed(Stream.empty),
          latestSequence: Effect.succeed(0),
        } satisfies OrchestrationEngine.OrchestrationEngineService["Service"]),
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );

      assert.deepStrictEqual(targets, { bootstrapProjectId });
      assert.deepStrictEqual(yield* Ref.get(dispatchCalls), []);
    });
  },
);

// witness: apps/server/src/serverRuntimeStartup.ts |   if (!serverConfig.autoBootstrapProjectFromCwd) return {} as const; →   if (serverConfig.autoBootstrapProjectFromCwd) return {} as const;
it.effect(
  "BT5: With auto-bootstrap on, a working directory without a project gets exactly one project create, carrying no model selection, and no thread",
  () =>
    Effect.gen(function* () {
      const dispatched = yield* Ref.make<
        ReadonlyArray<{ readonly type: string; readonly defaultModelSelection?: unknown }>
      >([]);
      const targets = yield* ServerRuntimeStartup.resolveAutoBootstrapProject.pipe(
        Effect.provideService(ServerConfig.ServerConfig, {
          cwd: "/tmp/startup-project",
          autoBootstrapProjectFromCwd: true,
        } as never),
        Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
        } as never),
        Effect.provideService(OrchestrationEngine.OrchestrationEngineService, {
          dispatch: (command: { readonly type: string }) =>
            Ref.update(dispatched, (all) => [...all, command]).pipe(Effect.as({ sequence: 1 })),
        } as never),
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );

      assert.equal(typeof targets.bootstrapProjectId, "string");
      assert.notProperty(targets, "bootstrapThreadId");
      const commands = yield* Ref.get(dispatched);
      assert.deepStrictEqual(
        commands.map((command) => command.type),
        ["project.create"],
      );
      assert.equal("defaultModelSelection" in commands[0]!, false);
    }),
);

// witness: apps/server/src/serverRuntimeStartup.ts |       yield* open.pipe(Scope.provide(input.reactorScope)); →       void open;
it.effect("BT6: At startup the Mate engine boots and its opening runs in the reactor scope", () =>
  Effect.gen(function* () {
    const started: Array<string> = [];
    const scope = yield* Scope.make();
    yield* ServerRuntimeStartup.startConversationRoots({
      engine: {
        ...inertMateEngine,
        boot: () => Effect.succeed(Effect.sync(() => void started.push("engine"))),
      },
      reactorScope: scope,
    });
    yield* Scope.close(scope, Exit.void);
    assert.deepStrictEqual(started, ["engine"]);
  }),
);

// witness: apps/server/src/startupAccess.ts | host.includes(":") && !host.startsWith("[") ? `[${host}]` : host; → host.includes(":") && host.startsWith("[") ? `[${host}]` : host;
it("BT7: The announced address is `localhost` when no host is set, keeps an explicit host with an IPv6 address in brackets, and turns a wildcard host into the machine's external IPv4 address", () => {
  expect(resolveHeadlessConnectionHost(undefined)).toBe("localhost");
  expect(resolveHeadlessConnectionString(undefined, 3773)).toBe("http://localhost:3773");
  expect(resolveHeadlessConnectionString("127.0.0.1", 3773)).toBe("http://127.0.0.1:3773");
  expect(resolveHeadlessConnectionString("::1", 3773)).toBe("http://[::1]:3773");
  expect(
    resolveHeadlessConnectionString("0.0.0.0", 3773, {
      en0: [
        {
          address: "192.168.1.42",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: false,
          cidr: "192.168.1.42/24",
        },
      ],
      lo0: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        },
      ],
    }),
  ).toBe("http://192.168.1.42:3773");
});

// witness: apps/server/src/startupAccess.ts |     typeof address.port === "number" →     typeof address.port === "string"
it("BT8: The announced port is the port the server actually bound, the configured one only when no bound port is known", () => {
  expect(resolveListeningPort({ port: 4123 }, 3773)).toBe(4123);
  expect(resolveListeningPort("pipe", 3773)).toBe(3773);
  expect(resolveListeningPort(null, 3773)).toBe(3773);
});

// witness: apps/server/src/startupAccess.ts |   hqOrigin = DEFAULT_HQ_ORIGIN, →   hqOrigin = "https://app.zerops.io",
it("BT9: A Zerops container announces its address and the HQ it is opened through, by default `https://mate-hq.zerops.io`, and never a token, a pairing link or a QR code", () => {
  const output = formatZeropsServeOutput("http://127.0.0.1:3773");

  expect(output).toContain("http://127.0.0.1:3773");
  expect(output).toContain("Open this Mate through HQ at https://mate-hq.zerops.io");
  expect(output).not.toContain("Token:");
  expect(output).not.toContain("/pair");
  expect(output).not.toContain("#token=");
  assert.isFalse(output.includes("█"));
  expect(formatZeropsServeOutput("http://127.0.0.1:3773", "https://hq.example.test")).toContain(
    "Open this Mate through HQ at https://hq.example.test",
  );
});
