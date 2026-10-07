// @effect-diagnostics nodeBuiltinImport:off - verifies native fixture process lifetimes.
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeChildProcess from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { isHostWindows } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import { claudeTestProcessSuite, countFixtureProcesses } from "./claudeTestProcess.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });
const ownClaudeTestProcesses = claudeTestProcessSuite();

for (const outcome of ["success", "failure", "timeout"] as const) {
  it.effect(`leaves no fake provider or descendant after test ${outcome}`, () =>
    Effect.gen(function* () {
      if (yield* isHostWindows) return;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "claude-process-owner-" });
      const binaryPath = path.join(dir, "claude");
      yield* fs.writeFileString(
        binaryPath,
        [
          "#!/usr/bin/env node",
          'import * as ChildProcess from "node:child_process";',
          'import * as Readline from "node:readline";',
          'process.on("SIGTERM", () => {});',
          'if (process.argv.includes("--descendant")) {',
          '  process.send("ready");',
          "  process.disconnect();",
          "  setInterval(() => {}, 1000);",
          "} else {",
          "  const child = ChildProcess.spawn(process.execPath, [process.argv[1], '--descendant'], {",
          "    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],",
          "  });",
          "  const ready = new Promise(resolve => child.once('message', resolve));",
          "  const lines = Readline.createInterface({ input: process.stdin });",
          "  lines.on('line', async line => {",
          "    const message = JSON.parse(line);",
          "    if (message.request?.subtype !== 'initialize') return;",
          "    await ready;",
          "    process.stdout.write(JSON.stringify({",
          "      type: 'control_response',",
          "      response: { subtype: 'success', request_id: message.request_id,",
          "        response: { commands: [], agents: [], models: [] } },",
          "    }) + '\\n');",
          "  });",
          // Deliberately ignores EOF: teardown must own even an uncooperative fake.
          "  setInterval(() => {}, 1000);",
          "}",
        ].join("\n"),
      );
      yield* fs.chmod(binaryPath, 0o755);
      const before = countFixtureProcesses(binaryPath);
      expect(before).toBe(0);
      const initialized = yield* Deferred.make<void>();
      const run = Effect.gen(function* () {
        yield* ownClaudeTestProcesses(binaryPath);
        const query = ClaudeSdk.query({
          prompt: (async function* () {})(),
          options: { pathToClaudeCodeExecutable: binaryPath },
        });
        yield* Effect.promise(() => query.initializationResult());
        expect(countFixtureProcesses(binaryPath)).toBe(2);
        yield* Deferred.succeed(initialized, undefined);
        if (outcome === "failure") return yield* Effect.fail("fixture failure");
        if (outcome === "timeout") return yield* Effect.never;
      }).pipe(Effect.scoped);
      if (outcome === "timeout") {
        const fiber = yield* run.pipe(Effect.timeout("1 second"), Effect.exit, Effect.forkChild);
        yield* Deferred.await(initialized);
        yield* TestClock.adjust("1 second");
        expect(Exit.isFailure(yield* Fiber.join(fiber))).toBe(true);
      } else {
        const result = yield* Effect.exit(run);
        expect(Exit.isSuccess(result)).toBe(outcome === "success");
      }
      expect(countFixtureProcesses(binaryPath)).toBe(before);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}

it.live("the Claude readiness fake exits when its stdin closes", () =>
  Effect.gen(function* () {
    if (yield* isHostWindows) return;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "claude-fixture-eof-" });
    const binaryPath = path.join(dir, "claude");
    yield* fs.copyFile(
      path.join(
        import.meta.dirname,
        "../provider/Layers/testing/ProviderInstanceRegistryLive.fixture.mjs",
      ),
      binaryPath,
    );
    const { child, closed } = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const child = NodeChildProcess.spawn(process.execPath, [binaryPath], {
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const closed = new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        return { child, closed };
      }),
      ({ child, closed }) =>
        Effect.promise(async () => {
          if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
            process.kill(-child.pid, "SIGKILL");
          }
          await closed;
        }),
    );
    child.stdin.end();
    expect(yield* Effect.promise(() => closed)).toBe(0);
    expect(countFixtureProcesses(binaryPath)).toBe(0);
  }).pipe(Effect.provide(NodeServices.layer)),
);
