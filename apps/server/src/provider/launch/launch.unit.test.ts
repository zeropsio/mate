import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import { CodexSettings } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeHomePath,
} from "../Drivers/ClaudeHome.ts";
import { materializeCodexShadowHome, resolveCodexHomeLayout } from "../Drivers/CodexHomeLayout.ts";
import { withOpenCodeInstallerPath } from "../Drivers/OpenCodeDriver.ts";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  type OpenCodeRuntimeShape,
} from "../opencodeRuntime.ts";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

function unusedRuntimeMethod() {
  return Effect.fail(
    new OpenCodeRuntimeError({
      operation: "unused",
      detail: "unused test method",
    }),
  );
}

// witness: apps/server/src/provider/Drivers/ClaudeHome.ts | return path.resolve(path.join(NodeOS.homedir(), ".claude")); → return path.resolve(NodeOS.homedir());
it.effect(
  "PL1: An empty Claude home, `~/.claude` and its expanded path are one Claude home with one continuation group, and an empty home leaves Claude's environment as given",
  () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resolved = path.resolve(path.join(NodeOS.homedir(), ".claude"));

      expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
      expect(yield* resolveClaudeHomePath({ homePath: "~/.claude" })).toBe(resolved);
      expect(yield* resolveClaudeHomePath({ homePath: resolved })).toBe(resolved);
      const baseEnvironment = { PATH: "/usr/bin" };
      expect(yield* makeClaudeEnvironment({ homePath: "" }, baseEnvironment)).toBe(baseEnvironment);

      const key = `claude:home:${resolved}`;
      expect(yield* makeClaudeContinuationGroupKey({ homePath: "" })).toBe(key);
      expect(yield* makeClaudeContinuationGroupKey({ homePath: "~/.claude" })).toBe(key);
      expect(yield* makeClaudeContinuationGroupKey({ homePath: resolved })).toBe(key);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/ClaudeHome.ts | CLAUDE_CONFIG_DIR: resolvedHomePath, → HOME: resolvedHomePath,
it.effect(
  "PL2: A configured Claude home is resolved from `~`, reaches Claude as `CLAUDE_CONFIG_DIR`, and names the continuation group and the capability cache key, which also differs per working directory",
  () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const homePath = "~/.claude-work";
      const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

      expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
      expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
      expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
      expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
        `claude\0${resolved}\0`,
      );

      const config = { binaryPath: "claude", homePath: "" };
      const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
      const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
      expect(first).not.toBe(second);
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/ClaudeHome.ts | const inherited = environment?.CLAUDE_CONFIG_DIR?.trim() ?? ""; → const inherited = "";
it.effect(
  "PL3: With no configured Claude home an inherited `CLAUDE_CONFIG_DIR` names the home and its continuation group, and a configured home outranks it",
  () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const inherited = path.resolve("/tmp/claude-inherited");
      const environment = { CLAUDE_CONFIG_DIR: inherited };

      expect(yield* resolveClaudeHomePath({ homePath: "" }, environment)).toBe(inherited);
      expect(yield* makeClaudeContinuationGroupKey({ homePath: "" }, environment)).toBe(
        `claude:home:${inherited}`,
      );

      const explicit = path.resolve(NodeOS.homedir(), ".claude-work");
      expect(yield* resolveClaudeHomePath({ homePath: "~/.claude-work" }, environment)).toBe(
        explicit,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/CodexHomeLayout.ts | const effectiveHomePath = path.resolve(expandHomePath(shadowHomePath)); → const effectiveHomePath = sharedHomePath;
it.effect(
  "PL4: Without a shadow home Codex runs and continues in its one home, and with one it continues in the shared home and runs in the shadow home",
  () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const homePath = path.resolve("codex-home");
      const direct = yield* resolveCodexHomeLayout(decodeCodexSettings({ homePath }));
      expect(direct).toMatchObject({
        mode: "direct",
        sharedHomePath: homePath,
        effectiveHomePath: homePath,
        continuationKey: `codex:home:${homePath}`,
      });

      const sharedHome = path.resolve("codex-shared");
      const shadowHome = path.resolve("codex-shadow-root", "shadow");
      const overlay = yield* resolveCodexHomeLayout(
        decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
      );
      expect(overlay).toMatchObject({
        mode: "authOverlay",
        sharedHomePath: sharedHome,
        effectiveHomePath: shadowHome,
        continuationKey: `codex:home:${sharedHome}`,
      });
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/CodexHomeLayout.ts | if (!REPLACEABLE_SHARED_RUNTIME_ENTRIES.has(input.entryName)) { → if (REPLACEABLE_SHARED_RUNTIME_ENTRIES.has(input.entryName)) {
it.effect(
  "PL5: A Codex shadow home that is the shared home, or that holds a real file where a shared entry belongs, is refused",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const sameHome = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shared-",
      });
      const sameLayout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({ homePath: sameHome, shadowHomePath: sameHome }),
      );
      const sameResult = yield* materializeCodexShadowHome(sameLayout).pipe(Effect.result);
      assert(Result.isFailure(sameResult));
      expect(sameResult.failure._tag).toBe("CodexShadowHomePathConflictError");
      expect(sameResult.failure).toMatchObject({
        sharedHomePath: sameHome,
        effectiveHomePath: sameHome,
      });

      const sharedHome = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shared-",
      });
      const shadowRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shadow-root-",
      });
      const shadowHome = path.join(shadowRoot, "shadow");
      yield* fileSystem.writeFileString(
        path.join(sharedHome, "config.toml"),
        'model = "gpt-5-codex"\n',
      );
      yield* fileSystem.makeDirectory(shadowHome, { recursive: true });
      yield* fileSystem.writeFileString(path.join(shadowHome, "config.toml"), 'model = "local"\n');
      const layout = yield* resolveCodexHomeLayout(
        decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
      );
      const result = yield* materializeCodexShadowHome(layout).pipe(Effect.result);
      assert(Result.isFailure(result));
      expect(result.failure._tag).toBe("CodexShadowHomeEntryConflictError");
      expect(result.failure).toMatchObject({
        sharedHomePath: sharedHome,
        effectiveHomePath: shadowHome,
        entryName: "config.toml",
        linkPath: path.join(shadowHome, "config.toml"),
        targetPath: path.join(sharedHome, "config.toml"),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/Drivers/CodexHomeLayout.ts | const PRIVATE_ENTRY_NAMES = new Set(["auth.json", "auth.lock", "models_cache.json"]); → const PRIVATE_ENTRY_NAMES = new Set(["auth.json", "auth.lock"]);
it.effect(
  "PL6: A Codex shadow home links the shared home's sessions, config and MCP OAuth locks, replacing a lock directory Codex made locally, while its auth and models cache stay its own files and Codex's local log, memories and tmp directories stay as they are",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      // The shared state is linked; the shadow's own auth stays and its models cache link goes.
      const sharedHome = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shared-",
      });
      const shadowRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shadow-root-",
      });
      const shadowHome = path.join(shadowRoot, "shadow");
      yield* fileSystem.makeDirectory(path.join(sharedHome, "sessions"));
      yield* fileSystem.writeFileString(
        path.join(sharedHome, "config.toml"),
        'model = "gpt-5-codex"\n',
      );
      yield* fileSystem.writeFileString(
        path.join(sharedHome, "models_cache.json"),
        '{"models":["shared"]}\n',
      );
      yield* fileSystem.writeFileString(path.join(sharedHome, "auth.json"), '{"shared":true}\n');
      yield* fileSystem.makeDirectory(shadowHome, { recursive: true });
      yield* fileSystem.writeFileString(path.join(shadowHome, "auth.json"), '{"shadow":true}\n');
      yield* fileSystem.symlink(
        path.join(sharedHome, "models_cache.json"),
        path.join(shadowHome, "models_cache.json"),
      );
      yield* materializeCodexShadowHome(
        yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
        ),
      );
      expect(yield* fileSystem.readLink(path.join(shadowHome, "sessions"))).toBe(
        path.join(sharedHome, "sessions"),
      );
      expect(yield* fileSystem.readLink(path.join(shadowHome, "config.toml"))).toBe(
        path.join(sharedHome, "config.toml"),
      );
      expect(yield* fileSystem.readLink(path.join(shadowHome, "mcp-oauth-locks"))).toBe(
        path.join(sharedHome, "mcp-oauth-locks"),
      );
      expect(yield* fileSystem.exists(path.join(shadowHome, "models_cache.json"))).toBe(false);
      const authLink = yield* fileSystem
        .readLink(path.join(shadowHome, "auth.json"))
        .pipe(Effect.result);
      expect(authLink._tag).toBe("Failure");
      expect(yield* fileSystem.readFileString(path.join(shadowHome, "auth.json"))).toContain(
        "shadow",
      );

      // A lock directory Codex made in the shadow home is replaced by the shared one.
      const lockSharedHome = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shared-",
      });
      const lockShadowRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shadow-root-",
      });
      const lockShadowHome = path.join(lockShadowRoot, "shadow");
      const sharedLocks = path.join(lockSharedHome, "mcp-oauth-locks");
      const shadowLocks = path.join(lockShadowHome, "mcp-oauth-locks");
      yield* fileSystem.makeDirectory(sharedLocks, { recursive: true });
      yield* fileSystem.writeFileString(path.join(sharedLocks, "file-store.lock"), "");
      yield* fileSystem.makeDirectory(shadowLocks, { recursive: true });
      yield* fileSystem.writeFileString(path.join(shadowLocks, "file-store.lock"), "");
      yield* materializeCodexShadowHome(
        yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: lockSharedHome, shadowHomePath: lockShadowHome }),
        ),
      );
      expect(yield* fileSystem.readLink(shadowLocks)).toBe(sharedLocks);
      expect(yield* fileSystem.exists(path.join(sharedLocks, "file-store.lock"))).toBe(true);

      // Codex's shadow-local runtime directories are accepted and left unlinked.
      const localSharedHome = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shared-",
      });
      const localShadowRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-codex-shadow-root-",
      });
      const localShadowHome = path.join(localShadowRoot, "shadow");
      yield* fileSystem.makeDirectory(path.join(localSharedHome, "log"));
      yield* fileSystem.makeDirectory(path.join(localSharedHome, "memories"));
      yield* fileSystem.makeDirectory(path.join(localSharedHome, "tmp"));
      yield* fileSystem.writeFileString(
        path.join(localSharedHome, "config.toml"),
        'model = "gpt-5-codex"\n',
      );
      yield* fileSystem.makeDirectory(localShadowHome, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(localShadowHome, "auth.json"),
        '{"shadow":true}\n',
      );
      yield* fileSystem.makeDirectory(path.join(localShadowHome, "log"), { recursive: true });
      yield* fileSystem.makeDirectory(path.join(localShadowHome, "memories"), { recursive: true });
      yield* fileSystem.makeDirectory(path.join(localShadowHome, "tmp"), { recursive: true });
      yield* materializeCodexShadowHome(
        yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: localSharedHome, shadowHomePath: localShadowHome }),
        ),
      );
      expect(yield* fileSystem.readLink(path.join(localShadowHome, "config.toml"))).toBe(
        path.join(localSharedHome, "config.toml"),
      );
      for (const local of ["log", "memories", "tmp"]) {
        const link = yield* fileSystem
          .readLink(path.join(localShadowHome, local))
          .pipe(Effect.result);
        expect(link._tag).toBe("Failure");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/provider/OpenCodeServerOwner.ts | if (yield* state.server.isRunning) { → if (state.server !== null) {
it.effect(
  "PL7: A borrower of an OpenCode server whose process has exited or stopped running gets a newly started server, and the dead one is closed",
  () =>
    Effect.gen(function* () {
      // The process exits: its exit watcher closes it and the next borrower starts a new one.
      const exitedStarts = yield* Ref.make(0);
      const processExits: Array<Deferred.Deferred<number>> = [];
      const processClosed = yield* Deferred.make<void>();
      const exitingRuntime: OpenCodeRuntimeShape = {
        startOpenCodeServerProcess: () =>
          Effect.gen(function* () {
            const index = yield* Ref.updateAndGet(exitedStarts, (count) => count + 1);
            const exitCode = yield* Deferred.make<number>();
            processExits.push(exitCode);
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(processClosed, undefined).pipe(Effect.ignore),
            );
            return {
              url: `http://127.0.0.1:${index}`,
              version: "1.14.19",
              isRunning: Effect.succeed(true),
              exitCode: Deferred.await(exitCode),
            };
          }),
        connectToOpenCodeServer: unusedRuntimeMethod,
        runOpenCodeCommand: unusedRuntimeMethod,
        createOpenCodeSdkClient: () => ({}) as never,
        loadOpenCodeInventory: unusedRuntimeMethod,
        loadOpenCodeSkills: unusedRuntimeMethod,
        loadInventoryFromCli: unusedRuntimeMethod,
        loadSkillsFromCli: unusedRuntimeMethod,
      };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* OpenCodeServerOwner.make({
            binaryPath: "opencode",
            directory: "/project",
          });
          expect(yield* owner.withServer((server) => Effect.succeed(server.url))).toBe(
            "http://127.0.0.1:1",
          );
          yield* Deferred.succeed(processExits[0]!, 1);
          yield* Deferred.await(processClosed);
          expect(yield* owner.withServer((server) => Effect.succeed(server.url))).toBe(
            "http://127.0.0.1:2",
          );
        }),
      ).pipe(Effect.provideService(OpenCodeRuntime, exitingRuntime));
      expect(yield* Ref.get(exitedStarts)).toBe(2);

      // The process stops running before its exit watcher runs: the borrower still gets a new one.
      const starts = yield* Ref.make(0);
      const closes = yield* Ref.make(0);
      const processRunning: Array<Ref.Ref<boolean>> = [];
      const stoppingRuntime: OpenCodeRuntimeShape = {
        startOpenCodeServerProcess: () =>
          Effect.gen(function* () {
            const index = yield* Ref.updateAndGet(starts, (count) => count + 1);
            const isRunning = yield* Ref.make(true);
            processRunning.push(isRunning);
            yield* Effect.addFinalizer(() => Ref.update(closes, (count) => count + 1));
            return {
              url: `http://127.0.0.1:${index}`,
              version: "1.14.19",
              isRunning: Ref.get(isRunning),
              exitCode: Effect.never,
            };
          }),
        connectToOpenCodeServer: unusedRuntimeMethod,
        runOpenCodeCommand: unusedRuntimeMethod,
        createOpenCodeSdkClient: () => ({}) as never,
        loadOpenCodeInventory: unusedRuntimeMethod,
        loadOpenCodeSkills: unusedRuntimeMethod,
        loadInventoryFromCli: unusedRuntimeMethod,
        loadSkillsFromCli: unusedRuntimeMethod,
      };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* OpenCodeServerOwner.make({
            binaryPath: "opencode",
            directory: "/project",
          });
          expect(yield* owner.withServer((server) => Effect.succeed(server.url))).toBe(
            "http://127.0.0.1:1",
          );
          yield* Ref.set(processRunning[0]!, false);
          expect(yield* owner.withServer((server) => Effect.succeed(server.url))).toBe(
            "http://127.0.0.1:2",
          );
          expect(yield* Ref.get(starts)).toBe(2);
          expect(yield* Ref.get(closes)).toBe(1);
        }),
      ).pipe(Effect.provideService(OpenCodeRuntime, stoppingRuntime));
    }),
);

// witness: apps/server/src/provider/OpenCodeServerOwner.ts | ...(input.environment ? { environment: input.environment } : {}), → ...{},
it.effect(
  "PL8: OpenCode's server starts with the keys stored on its instance in its environment",
  () =>
    Effect.gen(function* () {
      const environments: Array<NodeJS.ProcessEnv | undefined> = [];
      const runtime: OpenCodeRuntimeShape = {
        startOpenCodeServerProcess: (input) =>
          Effect.sync(() => {
            environments.push(input.environment);
            return {
              url: "http://127.0.0.1:1",
              version: "1.14.19",
              isRunning: Effect.succeed(true),
              exitCode: Effect.never,
            };
          }),
        connectToOpenCodeServer: unusedRuntimeMethod,
        runOpenCodeCommand: unusedRuntimeMethod,
        createOpenCodeSdkClient: () => ({}) as never,
        loadOpenCodeInventory: unusedRuntimeMethod,
        loadOpenCodeSkills: unusedRuntimeMethod,
        loadInventoryFromCli: unusedRuntimeMethod,
        loadSkillsFromCli: unusedRuntimeMethod,
      };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* OpenCodeServerOwner.make({
            binaryPath: "opencode",
            directory: "/project",
            environment: mergeProviderInstanceEnvironment(
              [{ name: "NEBIUS_API_KEY", value: "nb-acme-key", sensitive: true }],
              { PATH: "/usr/bin" },
            ),
          });
          yield* owner.withServer((server) => Effect.succeed(server.url));
        }),
      ).pipe(Effect.provideService(OpenCodeRuntime, runtime));
      expect(environments).toEqual([{ PATH: "/usr/bin", NEBIUS_API_KEY: "nb-acme-key" }]);
    }),
);

// witness: apps/server/src/provider/Drivers/OpenCodeDriver.ts | return { ...environment, PATH: mergePathValues(environment.PATH, installerBin, platform) }; → return { ...environment, PATH: mergePathValues(installerBin, environment.PATH, platform) };
it.effect(
  "PL9: On Linux and macOS OpenCode's installer directory is appended to the instance's PATH, after the entries already there, so an OpenCode found on PATH wins, and on Windows the PATH is left as it is",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-opencode-home-" });
      const emptyPath = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-opencode-path-",
      });
      const onPath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-opencode-path-" });
      const installerBin = path.join(home, ".opencode", "bin");

      expect(withOpenCodeInstallerPath({ PATH: onPath }, home, "linux", path).PATH).toBe(
        `${onPath}:${installerBin}`,
      );
      expect(withOpenCodeInstallerPath({ PATH: emptyPath }, home, "linux", path).PATH).toBe(
        `${emptyPath}:${installerBin}`,
      );
      const windowsEnvironment = { PATH: onPath };
      expect(withOpenCodeInstallerPath(windowsEnvironment, home, "win32", path)).toBe(
        windowsEnvironment,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
