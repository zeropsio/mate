// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises Node HTTP and filesystem boundaries.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as CliError from "effect/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { cli } from "./bin.ts";
import { PersistedServerRuntimeState } from "./serverRuntimeState.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const runCli = (args: ReadonlyArray<string>, command = cli) =>
  Command.runWith(command, { version: "0.0.0" })(args);
const runCliWithRuntime = (args: ReadonlyArray<string>) =>
  runCli(args).pipe(Effect.provide(CliRuntimeLayer));

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

it.layer(NodeServices.layer)("bin cli parsing", (it) => {
  it.effect("accepts the built-in lowercase log-level flag values", () =>
    runCliWithRuntime(["--log-level", "debug", "--version"]),
  );

  it.effect("accepts canonical --no-<flag> boolean negation", () =>
    runCliWithRuntime(["--no-log-websocket-events", "--version"]),
  );

  it.effect("rejects invalid log-level casing before launching the server", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["--log-level", "Debug"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${error._tag}`);
      }
      assert.equal(error.option, "log-level");
      assert.equal(error.value, "Debug");
    }),
  );

  it.effect("exposes service lifecycle commands", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["service", "--help"]));

      assert.include(output, "Manage the Zerops Mate background service.");
      assert.include(output, "install");
      assert.include(output, "uninstall");
      assert.include(output, "update");
      assert.include(output, "status");
    }),
  );

  it.effect("does not expose the removed connect command", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["--help"]));

      assert.notInclude(output, "connect");
    }),
  );

  it.effect("serve accepts --no-browser", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["serve", "--help"]));

      assert.include(output, "no-browser");
    }),
  );

  it.effect("does not expose legacy pair or auth commands", () =>
    Effect.gen(function* () {
      const { output } = yield* captureStdout(runCli(["--help"]));
      assert.notMatch(output, /(?:^|\n)\s+(?:pair|auth)\s/);
    }),
  );
});

const encodeRuntimeState = Schema.encodeEffect(Schema.fromJsonString(PersistedServerRuntimeState));
const pathExists = (path: string) => Effect.sync(() => NodeFS.existsSync(path));

it.layer(NodeServices.layer)("mate server command safety", (it) => {
  it.effect("rejects unknown command words without creating a home or project", () =>
    Effect.gen(function* () {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-cli-unknown-"));
      const baseDir = NodePath.join(root, "home");
      for (const word of ["projcet", "triag", "servce", "package.json", "C:new-project"]) {
        const error = yield* runCliWithRuntime([word, "--base-dir", baseDir]).pipe(Effect.flip);
        assert.include(String(error), `Unknown command "${word}"`);
        assert.equal(yield* pathExists(word), word === "package.json");
        assert.isFalse(yield* pathExists(baseDir));
      }
    }),
  );

  it.effect("shows help without creating state", () =>
    Effect.gen(function* () {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-cli-help-"));
      const baseDir = NodePath.join(root, "home");
      const help = yield* runCliWithRuntime(["help"]).pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { T3CODE_HOME: baseDir } })),
        ),
        Effect.flip,
      );
      assert.deepInclude(help, { _tag: "ShowHelp", commandPath: ["mate"], errors: [] });
      assert.isFalse(yield* pathExists(baseDir));
    }),
  );

  it.effect("refuses a manual start over a live server before creating directories", () =>
    Effect.gen(function* () {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-cli-running-"));
      const baseDir = NodePath.join(root, "home");
      const stateDir = NodePath.join(baseDir, "userdata");
      const statePath = NodePath.join(stateDir, "server-runtime.json");
      const record = yield* encodeRuntimeState({
        version: 1,
        pid: process.pid,
        port: 3773,
        origin: "http://127.0.0.1:3773",
        startedAt: "2026-10-01T00:00:00.000Z",
      });
      NodeFS.mkdirSync(stateDir, { recursive: true });
      NodeFS.writeFileSync(statePath, record);
      const newDirectory = NodePath.join(root, "new-project");
      for (const args of [
        [],
        ["start"],
        ["."],
        ["node_modules"],
        [newDirectory],
        ["start", newDirectory],
      ]) {
        const error = yield* runCliWithRuntime([...args, "--base-dir", baseDir]).pipe(Effect.flip);
        assert.include(String(error), "A Zerops Mate server is already running");
        assert.equal(NodeFS.readFileSync(statePath, "utf8"), record);
        assert.isFalse(yield* pathExists(newDirectory));
        assert.deepEqual(NodeFS.readdirSync(stateDir), ["server-runtime.json"]);
      }
    }),
  );
});

const encodeTraceLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it.layer(NodeServices.layer)("mate trace summary", (it) => {
  it.effect("summarizes the trace file and its rotated backups", () =>
    Effect.gen(function* () {
      const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-cli-trace-"));
      const traceFile = NodePath.join(root, "server.trace.ndjson");
      const span = (name: string, durationMs: number) =>
        encodeTraceLine({
          type: "effect-span",
          name,
          durationMs,
          endTimeUnixNano: "1000000000000000000",
          exit: { _tag: "Success" },
        });
      NodeFS.writeFileSync(traceFile, `${span("refresh", 12)}\n`);
      NodeFS.writeFileSync(`${traceFile}.1`, `${span("refresh", 30)}\n${span("probe", 5)}\n`);

      const { output } = yield* captureStdout(
        runCli(["trace", "summary"]).pipe(
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { T3CODE_TRACE_FILE: traceFile } })),
          ),
        ),
      );

      assert.include(output, "3 spans ended");
      assert.match(output, /refresh\s+2\s/);
      assert.match(output, /probe\s+1\s/);
    }),
  );
});
