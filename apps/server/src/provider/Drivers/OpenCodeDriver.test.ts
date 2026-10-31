import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { OpenCodeSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import { checkOpenCodeProviderStatus } from "../Layers/OpenCodeProvider.ts";
import { OpenCodeRuntime, OpenCodeRuntimeError, OpenCodeRuntimeLive } from "../opencodeRuntime.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ProviderEventLoggers, NoOpProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";
import { OpenCodeDriver, withOpenCodeInstallerPath } from "./OpenCodeDriver.ts";

const testLayer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));

// The probe reads the version; the inventory needs a running server, which a
// stub binary does not give, so the owner refuses at once.
const noServer = OpenCodeServerOwner.OpenCodeServerOwner.of({
  withServer: () =>
    Effect.fail(
      new OpenCodeRuntimeError({ operation: "startOpenCodeServerProcess", detail: "no server" }),
    ),
});

// The `#!/bin/sh` stubs below cannot be resolved as executables on Windows.
const windowsHost = HostProcessPlatform.defaultValue() === "win32";

const writeOpenCode = Effect.fn("writeOpenCode")(function* (file: string, version: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, `#!/bin/sh\necho ${version}\n`);
  yield* fs.chmod(file, 0o755);
});

const decodeSettings = Schema.decodeSync(OpenCodeSettings);
const enabledOpenCode = decodeSettings({ enabled: true });

it.effect.skipIf(windowsHost)(
  "owned native tool readiness reads the actual local runtime and refuses missing or external execution",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let ids = ["mate_workflow"];
        let calls = 0;
        let starts = 0;
        const runtime = OpenCodeRuntime.of({
          startOpenCodeServerProcess: () =>
            Effect.sync(() => {
              starts++;
              return {
                url: "http://127.0.0.1:1",
                version: "1.14.19",
                isRunning: Effect.succeed(true),
                exitCode: Effect.never,
              };
            }),
          connectToOpenCodeServer: () => Effect.die("not a native turn"),
          runOpenCodeCommand: () => Effect.die("no CLI command"),
          createOpenCodeSdkClient: () =>
            ({
              tool: {
                ids: async () => {
                  calls++;
                  return { data: ids };
                },
              },
            }) as never,
          loadOpenCodeInventory: () => Effect.die("no inventory"),
          loadOpenCodeSkills: () => Effect.die("no skills"),
          loadInventoryFromCli: () => Effect.die("no CLI inventory"),
          loadSkillsFromCli: () => Effect.die("no CLI skills"),
        });
        const create = (serverUrl: string) =>
          OpenCodeDriver.create({
            instanceId: ProviderInstanceId.make("opencode"),
            displayName: undefined,
            environment: [],
            enabled: true,
            config: decodeSettings({ enabled: true, serverUrl }),
          }).pipe(Effect.provideService(OpenCodeRuntime, runtime));
        const local = yield* create("");
        expect(yield* local.toolInvocationReady!).toBe(true);
        expect(calls).toBe(1);
        expect(starts).toBe(1);
        yield* TestClock.adjust("31 seconds");
        expect(yield* local.toolInvocationReady!).toBe(true);
        expect(calls).toBe(1);
        expect(starts).toBe(1);
        ids = [];
        const replacement = yield* create("");
        expect(yield* replacement.toolInvocationReady!).toBe(false);
        expect(calls).toBe(2);
        expect(starts).toBe(2);
        // An actual native session failure invalidates the previously positive proof.
        expect(
          (yield* Effect.result(
            local.adapter.startSession({
              threadId: ThreadId.make("native-failure/s/1"),
              runtimeMode: "full-access",
            }),
          ))._tag,
        ).toBe("Failure");
        expect(yield* local.toolInvocationReady!).toBe(false);
        expect(calls).toBe(3);
        ids = ["mate_workflow"];
        expect(yield* local.toolInvocationReady!).toBe(false);
        expect(calls).toBe(3);
        yield* TestClock.adjust("31 seconds");
        expect(yield* local.toolInvocationReady!).toBe(true);
        expect(calls).toBe(4);
        const external = yield* create("http://127.0.0.1:9999");
        expect(yield* external.toolInvocationReady!).toBe(false);
        expect(calls).toBe(4);
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerConfig.layerTest(process.cwd(), { prefix: "opencode-execution-ready" }),
          ServerSettingsService.layerTest(),
          Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers),
          Layer.mock(BackgroundPolicy.BackgroundPolicy)({
            shouldRunScopeWork: () => Effect.succeed(false),
          }),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}))),
            ),
          ),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    ),
);

const statusWith = (environment: NodeJS.ProcessEnv) =>
  checkOpenCodeProviderStatus(enabledOpenCode, process.cwd(), environment).pipe(
    Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, noServer),
  );

it.layer(testLayer)("OpenCodeDriver", (it) => {
  it.effect.skipIf(windowsHost)(
    "OpenCode installed at the official installer's home location reads as installed with its version when it is not on PATH",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-home-" });
        const emptyPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-path-" });
        // A Mate container's OpenCode: the official installer's location, which
        // only a login shell's rc adds to PATH.
        yield* writeOpenCode(path.join(home, ".opencode", "bin", "opencode"), "1.18.34");

        const before = yield* statusWith({ PATH: emptyPath });
        expect(before.installed).toBe(false);

        const after = yield* statusWith(
          withOpenCodeInstallerPath({ PATH: emptyPath }, home, "linux", path),
        );
        expect(after.installed).toBe(true);
        expect(after.version).toBe("1.18.34");
      }).pipe(Effect.scoped),
  );

  it.effect.skipIf(windowsHost)("an OpenCode on PATH wins over the installer's location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-home-" });
      const onPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-path-" });
      yield* writeOpenCode(path.join(home, ".opencode", "bin", "opencode"), "1.18.34");
      yield* writeOpenCode(path.join(onPath, "opencode"), "1.19.3");

      const status = yield* statusWith(
        withOpenCodeInstallerPath({ PATH: onPath }, home, "linux", path),
      );
      expect(status.version).toBe("1.19.3");
    }).pipe(Effect.scoped),
  );
});
