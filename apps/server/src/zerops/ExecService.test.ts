import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { EXEC_MAX_TIMEOUT_MS, runExecCommand } from "./ExecService.ts";

const zeropsEnvironment = resolveZeropsEnvironment({
  projectId: "nTV3oMB2SS634ImDJnQckg",
  apiHost: undefined,
  allowedOrigins: [],
  membershipTtlSeconds: undefined,
});

const makeLayer = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  ProcessRunner.layer.pipe(
    Layer.provideMerge(
      Layer.effect(
        ServerConfig.ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          return {
            ...config,
            zerops: zeropsEnvironment,
            zeropsFixtures: undefined,
            ...overrides,
          } satisfies ServerConfig.ServerConfig["Service"];
        }),
      ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-exec-test-" }))),
    ),
  );

it.layer(NodeServices.layer)("runExecCommand", (it) => {
  it.effect("runs a command and reports its output and exit code", () =>
    Effect.gen(function* () {
      const result = yield* runExecCommand({
        command: "node",
        args: ["-e", "process.stdout.write('hello from the container')"],
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, "hello from the container");
      assert.strictEqual(result.stderr, "");
      assert.isFalse(result.timedOut);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("reports a non-zero exit and stderr rather than failing", () =>
    Effect.gen(function* () {
      const result = yield* runExecCommand({
        command: "node",
        args: ["-e", "process.stderr.write('it went wrong'); process.exit(3)"],
      });

      // A command that fails is a successful RPC with a failure in it: the
      // caller wants the exit code, not an error envelope.
      assert.strictEqual(result.exitCode, 3);
      assert.strictEqual(result.stderr, "it went wrong");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("passes arguments as a list, so nothing is ever shell-interpreted", () =>
    Effect.gen(function* () {
      const injection = "; echo pwned | tee /dev/null";
      const result = yield* runExecCommand({
        command: "node",
        args: ["-e", "process.stdout.write(process.argv[1] ?? 'none')", injection],
      });

      // Arrives as one opaque argument. There is no shell to interpret it.
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, injection);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("defaults the working directory to the workspace root", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const result = yield* runExecCommand({
        command: "node",
        args: ["-e", "process.stdout.write(process.cwd())"],
      });

      assert.strictEqual(result.stdout, config.cwd);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("refuses a deadline beyond what this environment allows", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runExecCommand({
          command: "node",
          args: ["-e", ""],
          timeoutMs: EXEC_MAX_TIMEOUT_MS + 1,
        }),
      );

      assert.strictEqual(error._tag, "ExecError");
      assert.strictEqual(error.reason, "invalid_timeout");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("reports a command that cannot be started at all", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        runExecCommand({ command: "definitely-not-a-real-binary-9f3a", args: [] }),
      );

      assert.strictEqual(error._tag, "ExecError");
      assert.strictEqual(error.reason, "spawn_failed");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("is not offered outside a Zerops project", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(runExecCommand({ command: "node", args: ["-e", ""] }));

      assert.strictEqual(error._tag, "ExecError");
      assert.strictEqual(error.reason, "unavailable");
    }).pipe(Effect.provide(makeLayer({ zerops: undefined }))),
  );

  it.effect("truncates rather than returning an unbounded body", () =>
    Effect.gen(function* () {
      const result = yield* runExecCommand({
        command: "node",
        args: ["-e", "process.stdout.write('x'.repeat(4 * 1024 * 1024))"],
      });

      assert.isTrue(result.stdoutTruncated);
      assert.isBelow(result.stdout.length, 4 * 1024 * 1024);
    }).pipe(Effect.provide(makeLayer())),
  );
});

// Outside the layer block so the live clock is available: the deadline is a
// real wall-clock timeout, and a virtual clock would never reach it.
it.live("kills a command that outlives its deadline", () =>
  Effect.gen(function* () {
    const result = yield* runExecCommand({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 60000)"],
      timeoutMs: 250,
    });

    assert.isTrue(result.timedOut);
    assert.isNull(result.exitCode);
  }).pipe(Effect.provide(makeLayer().pipe(Layer.provide(NodeServices.layer)))),
);
