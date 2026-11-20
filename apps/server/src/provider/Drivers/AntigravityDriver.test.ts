import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ANTIGRAVITY_DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import {
  HostProcessEnvironment,
  HostProcessExecutablePath,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import * as ModelManifest from "../ModelManifest.ts";
import { AntigravityDriver } from "./AntigravityDriver.ts";

const windowsHost = HostProcessPlatform.defaultValue() === "win32";
const decodeRequest = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      method: Schema.optional(Schema.String),
      params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const makeHarness = Effect.fn("makeAntigravityDriverHarness")(function* (
  options: { readonly enabled?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const nodePath = yield* HostProcessExecutablePath;
  const baseEnv = yield* HostProcessEnvironment;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-antigravity-driver-" });
  const mockAgentPath = yield* path.fromFileUrl(
    new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
  );
  const requestLog = path.join(root, "requests.jsonl");
  const signedOutMarker = path.join(root, "signed-out");
  const brokenMarker = path.join(root, "broken");
  // agy as the driver meets it: its version, `agy models`' measured answers,
  // and `agy acp` as the mock ACP agent.
  const agyPath = path.join(root, "agy's bin", "agy");
  yield* fs.makeDirectory(path.dirname(agyPath), { recursive: true });
  yield* fs.writeFileString(
    agyPath,
    [
      "#!/bin/sh",
      'case "$1" in',
      "  --version) echo 1.5.13 ;;",
      "  models)",
      "    echo 'Fetching available models...'",
      `    if [ -e ${shellQuote(signedOutMarker)} ]; then`,
      "      echo 'Error: Please sign in to view available models. Launch the CLI without arguments to sign in.'",
      "      exit 1",
      "    fi",
      "    echo gemini-test-low; echo gemini-test-high ;;",
      "  acp)",
      `    [ -e ${shellQuote(brokenMarker)} ] && exit 1`,
      `    [ -e ${shellQuote(signedOutMarker)} ] && export T3_ACP_ANTIGRAVITY_SIGNED_OUT=1`,
      `    exec ${shellQuote(nodePath)} ${shellQuote(mockAgentPath)} "$@" ;;`,
      "  *) exit 2 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  yield* fs.chmod(agyPath, 0o755);
  const launches: Array<{
    command: string;
    args: ReadonlyArray<string>;
    cwd: string | undefined;
    handle: ChildProcessSpawner.ChildProcessHandle;
  }> = [];
  const observedSpawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (command._tag !== "StandardCommand")
        return yield* Effect.die("Unexpected process pipeline.");
      const handle = yield* spawner.spawn(command);
      launches.push({
        command: command.command,
        args: command.args.map(String),
        cwd: command.options.cwd,
        handle,
      });
      return handle;
    }),
  );
  const instance = yield* AntigravityDriver.create({
    instanceId: ProviderInstanceId.make(path.basename(root)),
    displayName: "Google test account",
    enabled: options.enabled ?? false,
    config: { ...AntigravityDriver.defaultConfig(), binaryPath: agyPath },
    environment: [
      { name: "HOME", value: path.join(root, "home") },
      { name: "PATH", value: baseEnv.PATH ?? "" },
      { name: "T3_ACP_ANTIGRAVITY", value: "1" },
      { name: "T3_ACP_REQUEST_LOG_PATH", value: requestLog },
    ].map((variable) => ({ ...variable, sensitive: false })),
  }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observedSpawner));
  const refresh = instance.refreshModels;
  if (!refresh) return yield* Effect.die("Antigravity does not expose model refresh.");
  const readRequests = Effect.gen(function* () {
    if (!(yield* fs.exists(requestLog))) return [];
    const text = yield* fs.readFileString(requestLog);
    return yield* Effect.forEach(text.split(/\r?\n/u).filter(Boolean), (line) =>
      decodeRequest(line),
    );
  });
  const sessionLaunches = () => launches.filter((launch) => launch.args[0] === "acp");
  const assertClosed = Effect.gen(function* () {
    for (const launch of launches) {
      // Cancelled startup can report a signal instead of a numeric exit code.
      yield* launch.handle.exitCode.pipe(Effect.ignore);
      expect(yield* launch.handle.isRunning).toBe(false);
    }
    for (const launch of sessionLaunches()) {
      if (launch.cwd) expect(yield* fs.exists(launch.cwd)).toBe(false);
      const geminiDirectory = launch.args[launch.args.indexOf("--gemini-dir") + 1];
      if (geminiDirectory) expect(yield* fs.exists(geminiDirectory)).toBe(false);
    }
  });
  return {
    instance,
    refresh,
    fs,
    root,
    agyPath,
    signOut: fs.writeFileString(signedOutMarker, ""),
    breakAgy: fs.writeFileString(brokenMarker, ""),
    launches,
    sessionLaunches,
    readRequests,
    assertClosed,
  };
});

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-antigravity-driver-config-",
}).pipe(
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  Layer.provideMerge(ModelManifest.layerTest),
);

it.layer(testLayer)("AntigravityDriver", (it) => {
  it.effect.skipIf(windowsHost)("does not launch a process for a disabled instance", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      const snapshot = yield* h.instance.snapshot.refresh;
      expect(snapshot.status).toBe("disabled");
      expect(h.launches).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect.skipIf(windowsHost)(
    "reads agy's version and Google login, then the catalog from an `agy acp` session of its own",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ enabled: true });
        const snapshot = yield* h.instance.snapshot.refresh;
        expect(snapshot).toMatchObject({
          installed: true,
          version: "1.5.13",
          status: "ready",
          auth: { status: "authenticated", label: "Google account" },
          supportsTextGeneration: true,
        });
        expect(snapshot.models.map((model) => model.slug)).toEqual([
          "gemini-test-low",
          "gemini-test-high",
        ]);
        expect(snapshot.models[0]?.aliases).toContain(ANTIGRAVITY_DEFAULT_MODEL);
        expect(snapshot.slashCommands.map((command) => command.name)).toEqual(["plan", "logout"]);
        expect(h.launches.map((launch) => launch.command)).toEqual([
          h.agyPath,
          h.agyPath,
          h.agyPath,
        ]);
        expect(h.launches.map((launch) => launch.args.slice(0, 2))).toEqual([
          ["--version"],
          ["models"],
          ["acp", "--gemini-dir"],
        ]);
        const requests = yield* h.readRequests;
        expect(requests.map((request) => request.method)).toEqual([
          "initialize",
          "authenticate",
          "session/new",
        ]);
        expect(requests[1]?.params?.methodId).toBe("oauth-personal");
        expect(requests[2]?.params?.mcpServers).toEqual([]);
        yield* h.assertClosed;
      }).pipe(Effect.scoped),
  );

  it.effect.skipIf(windowsHost)(
    "closes refresh processes and clears account metadata when Google sign-in is required",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.refresh();
        yield* h.signOut;
        const error = yield* h.refresh().pipe(Effect.flip);
        expect(error.detail).toContain("Sign in to Antigravity");
        const snapshot = yield* h.instance.snapshot.getSnapshot;
        expect(snapshot.auth.status).toBe("unauthenticated");
        expect(snapshot.models).toEqual([]);
        expect(snapshot.slashCommands).toEqual([]);
        expect(snapshot.supportsTextGeneration).toBe(false);
        expect(h.sessionLaunches()).toHaveLength(2);
        yield* h.assertClosed;
      }).pipe(Effect.scoped),
  );

  it.effect.skipIf(windowsHost)(
    "clears account metadata when a text helper needs Google sign-in",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* h.refresh();
        yield* h.signOut;
        const error = yield* h.instance.textGeneration
          .generateThreadTitle({
            cwd: h.root,
            message: "Repair Google login",
            modelSelection: { instanceId: h.instance.instanceId, model: "gemini-test-low" },
          })
          .pipe(Effect.flip);
        expect(error._tag).toBe("TextGenerationError");
        const snapshot = yield* h.instance.snapshot.getSnapshot;
        expect(snapshot.auth.status).toBe("unauthenticated");
        expect(snapshot.models).toEqual([]);
        expect(snapshot.supportsTextGeneration).toBe(false);
        expect(h.sessionLaunches().map((launch) => launch.args.slice(0, 2))).toEqual([
          ["acp", "--gemini-dir"],
          ["acp", "--gemini-dir"],
        ]);
        yield* h.assertClosed;
      }).pipe(Effect.scoped),
  );

  it.effect.skipIf(windowsHost)("keeps the previous catalog when agy cannot start a session", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* h.refresh();
      const before = yield* h.instance.snapshot.getSnapshot;
      yield* h.breakAgy;
      const error = yield* h.refresh().pipe(Effect.flip);
      expect(error.detail).toContain("previous model list is unchanged");
      const after = yield* h.instance.snapshot.getSnapshot;
      expect(after.models).toEqual(before.models);
      expect(after.auth).toEqual(before.auth);
      yield* h.assertClosed;
    }).pipe(Effect.scoped),
  );
});
