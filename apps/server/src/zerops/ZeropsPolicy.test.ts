import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type { OrchestrationCommand, OrchestrationReadModel } from "@t3tools/contracts";
import { GitManagerError } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { ProviderRegistryTest } from "../spi/ProviderRegistryTest.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { decideOrchestrationCommand } from "../orchestration/decider.ts";
import { makeServerEnvironmentCapabilities } from "../environment/ServerEnvironment.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { UPSTREAM_POLICY, ZEROPS_POLICY, zeropsPolicy } from "./ZeropsPolicy.ts";

const zeropsEnvironment = resolveZeropsEnvironment({
  projectId: "nTV3oMB2SS634ImDJnQckg",
  apiHost: undefined,
  allowedOrigins: [],
  membershipTtlSeconds: undefined,
});

const configLayer = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return { ...config, ...overrides } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-zerops-policy-test-" })),
  );

const onZerops = configLayer({ zerops: zeropsEnvironment });
const offZerops = configLayer();

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [
    {
      id: "project-1",
      title: "kanban",
      workspaceRoot: "/var/www",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
      deletedAt: null,
    },
  ],
  threads: [],
  updatedAt: "2026-08-28T00:00:00.000Z",
} as unknown as OrchestrationReadModel;

const decide = (command: OrchestrationCommand) =>
  decideOrchestrationCommand({ command, readModel }).pipe(
    Effect.map((decided) => (Array.isArray(decided) ? decided : [decided])),
  );

const threadCreate = {
  type: "thread.create",
  commandId: "cmd-1",
  threadId: "thread-1",
  projectId: "project-1",
  title: "work",
  modelSelection: null,
  runtimeMode: null,
  interactionMode: null,
  branch: null,
  worktreePath: "/home/zerops/.t3/worktrees/thread-1",
  createdAt: "2026-08-28T00:00:00.000Z",
} as unknown as OrchestrationCommand;

it.layer(NodeServices.layer)("zeropsPolicy", (it) => {
  it.effect("is the upstream policy when no server config is in context at all", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* zeropsPolicy, UPSTREAM_POLICY);
    }),
  );

  it.effect("is the upstream policy off Zerops", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* zeropsPolicy, UPSTREAM_POLICY);
    }).pipe(Effect.provide(offZerops)),
  );

  it.effect("forbids worktrees, stacked actions and upstream refreshes on Zerops", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* zeropsPolicy, ZEROPS_POLICY);
    }).pipe(Effect.provide(onZerops)),
  );
});

it.layer(NodeServices.layer)("the decider is where the worktree rule is enforced", (it) => {
  it.effect("thread.create persists a null worktree path on Zerops", () =>
    Effect.gen(function* () {
      const [event] = yield* decide(threadCreate);
      assert.isDefined(event);
      assert.strictEqual(event.type, "thread.created");
      assert.strictEqual((event.payload as { readonly worktreePath: unknown }).worktreePath, null);
    }).pipe(Effect.provide(onZerops)),
  );

  it.effect("thread.create keeps the client's worktree path off Zerops", () =>
    Effect.gen(function* () {
      const [event] = yield* decide(threadCreate);
      assert.isDefined(event);
      assert.strictEqual(
        (event.payload as { readonly worktreePath: unknown }).worktreePath,
        "/home/zerops/.t3/worktrees/thread-1",
      );
    }).pipe(Effect.provide(offZerops)),
  );

  it.effect("project.meta.update forces the default thread env mode to local", () =>
    Effect.gen(function* () {
      const [event] = yield* decide({
        type: "project.meta.update",
        commandId: "cmd-2",
        projectId: "project-1",
        defaultThreadEnvMode: "worktree",
      } as unknown as OrchestrationCommand);
      assert.isDefined(event);
      assert.strictEqual(
        (event.payload as { readonly defaultThreadEnvMode: unknown }).defaultThreadEnvMode,
        "local",
      );
    }).pipe(Effect.provide(onZerops)),
  );

  it.effect("project.meta.update keeps the requested env mode off Zerops", () =>
    Effect.gen(function* () {
      const [event] = yield* decide({
        type: "project.meta.update",
        commandId: "cmd-2",
        projectId: "project-1",
        defaultThreadEnvMode: "worktree",
      } as unknown as OrchestrationCommand);
      assert.isDefined(event);
      assert.strictEqual(
        (event.payload as { readonly defaultThreadEnvMode: unknown }).defaultThreadEnvMode,
        "worktree",
      );
    }).pipe(Effect.provide(offZerops)),
  );
});

describe("the capabilities the client reads", () => {
  it("hides the stacked git pipeline on Zerops", () => {
    const capabilities = makeServerEnvironmentCapabilities(ZEROPS_POLICY);
    assert.strictEqual(capabilities.vcsStackedActions, false);
    assert.strictEqual(capabilities.worktreesAllowed, false);
  });

  it("stay on upstream everywhere else", () => {
    const capabilities = makeServerEnvironmentCapabilities(UPSTREAM_POLICY);
    assert.strictEqual(capabilities.vcsStackedActions, true);
    assert.strictEqual(capabilities.worktreesAllowed, true);
  });
});

const recordingDriverLayer = (recorded: Ref.Ref<ReadonlyArray<unknown>>) =>
  Layer.mock(GitVcsDriver.GitVcsDriver)({
    statusDetailsRemote: (_cwd: string, options?: unknown) =>
      Ref.update(recorded, (previous) => [...previous, options]).pipe(
        Effect.as({ isRepo: true, branch: null, upstreamRef: null }),
      ),
    statusDetails: () => Effect.succeed({ isRepo: true, branch: null }),
  } as never);

const managerLayer = (driver: Layer.Layer<GitVcsDriver.GitVcsDriver>) =>
  Layer.mergeAll(
    driver,
    Layer.mock(TextGeneration.TextGeneration)({} as never),
    ProviderRegistryTest.empty(),
    Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
      runForThread: () => Effect.succeed({ status: "no-script" as const }),
    } as never),
    Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
      discover: Effect.succeed([]),
    } as never),
    ServerSettings.ServerSettingsService.layerTest(),
  );

it.layer(NodeServices.layer)("GitManager under the Zerops policy", (it) => {
  it.effect("refuses the stacked commit/push/PR action server-side", () =>
    Effect.gen(function* () {
      const recorded = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const manager = yield* GitManager.make.pipe(
        Effect.provide(managerLayer(recordingDriverLayer(recorded))),
      );

      const error = yield* manager
        .runStackedAction({ cwd: "/var/www/kanbandev", action: "commit_push" } as never)
        .pipe(Effect.flip);

      assert.instanceOf(error, GitManagerError);
      assert.include(error.detail ?? "", "zcp");
    }).pipe(Effect.provide(onZerops)),
  );

  it.effect("never lets a status read fetch from a remote", () =>
    Effect.gen(function* () {
      const recorded = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const manager = yield* GitManager.make.pipe(
        Effect.provide(managerLayer(recordingDriverLayer(recorded))),
      );

      yield* manager.remoteStatus({ cwd: "/var/www/kanbandev" } as never);

      const calls = yield* Ref.get(recorded);
      assert.isAbove(calls.length, 0);
      for (const options of calls) {
        assert.strictEqual(
          (options as { readonly refreshUpstream?: boolean }).refreshUpstream,
          false,
        );
      }
    }).pipe(Effect.provide(onZerops)),
  );
});

/** A git executor that answers every command with a commit oid and records it. */
const recordingVcsProcess = (recorded: Ref.Ref<ReadonlyArray<ReadonlyArray<string>>>) =>
  Layer.succeed(VcsProcess.VcsProcess, {
    run: (input: VcsProcess.VcsProcessInput) =>
      Ref.update(recorded, (previous) => [...previous, input.args]).pipe(
        Effect.as({
          exitCode: 0,
          stdout: "0123456789abcdef0123456789abcdef01234567\n",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      ),
  } as never);

const restoreArgs = (config: typeof onZerops) =>
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    const shape = yield* GitVcsDriver.makeVcsDriverShape().pipe(
      Effect.provide(recordingVcsProcess(recorded)),
    );
    yield* shape.checkpoints.restoreCheckpoint({
      cwd: "/var/www/kanbandev",
      checkpointRef: "refs/t3/checkpoints/x/turn/1" as never,
      fallbackToHead: false,
    });
    return yield* Ref.get(recorded);
  }).pipe(Effect.provide(config));

it.layer(NodeServices.layer)("restoring a checkpoint", (it) => {
  it.effect("leaves what the running application wrote on Zerops", () =>
    Effect.gen(function* () {
      const args = yield* restoreArgs(onZerops);

      assert.isTrue(args.some((argv) => argv[2] === "restore"));
      assert.isFalse(args.some((argv) => argv[2] === "clean"));
    }),
  );

  it.effect("still cleans untracked files everywhere else", () =>
    Effect.gen(function* () {
      const args = yield* restoreArgs(offZerops);

      assert.isTrue(args.some((argv) => argv[2] === "restore"));
      assert.isTrue(args.some((argv) => argv[2] === "clean" && argv[3] === "-fd"));
    }),
  );
});
