import { assert, expect, it } from "@effect/vitest";
import { ExecError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { runExecCommand } from "../zerops/ExecService.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import { makeChildHomeSpawner } from "./childHome.ts";

const PROCESS_HOME = "/home/developer";
const MATE_HOME = "/tmp/scenario-mate/home";

const zeropsConfig = {
  cwd: "/srv/workspace",
  zerops: resolveZeropsEnvironment({ projectId: "TEST000000000000000023", apiHost: undefined }),
};

const ran: ProcessRunner.ProcessRunOutput = {
  stdout: "",
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
};

/** A runner that records what it is asked to run and answers with `answer`. */
const recordingRunner = (
  answer: Effect.Effect<ProcessRunner.ProcessRunOutput, ProcessRunner.ProcessRunError>,
) => {
  const calls: Array<ProcessRunner.ProcessRunInput> = [];
  const layer = Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) => {
      calls.push(input);
      return answer;
    },
  });
  return { calls, layer };
};

// witness: apps/server/src/process/childHome.ts | if (env?.HOME !== undefined && env.HOME !== inheritedHome) return command; → if (env?.HOME !== undefined) return command;
it.effect(
  "CH1: A child the server starts that would inherit the server's home resolves its home in the Mate's home, while a child handed a home of its own, or a full environment without one, keeps what its caller made",
  () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly options: ChildProcess.CommandOptions;
        readonly env: Record<string, string | undefined> | undefined;
        readonly extendEnv: boolean | undefined;
      }> = [
        { options: {}, env: { HOME: MATE_HOME }, extendEnv: true },
        {
          options: { env: { HOME: PROCESS_HOME, PATH: "/bin", GIT_OPTIONAL_LOCKS: "0" } },
          env: { HOME: MATE_HOME, PATH: "/bin", GIT_OPTIONAL_LOCKS: "0" },
          extendEnv: undefined,
        },
        {
          options: { env: { GIT_INDEX_FILE: "/tmp/index" }, extendEnv: true },
          env: { GIT_INDEX_FILE: "/tmp/index", HOME: MATE_HOME },
          extendEnv: true,
        },
        {
          options: { env: { HOME: "/tmp/login-home" }, extendEnv: true },
          env: { HOME: "/tmp/login-home" },
          extendEnv: true,
        },
        { options: { env: { PATH: "/bin" } }, env: { PATH: "/bin" }, extendEnv: undefined },
      ];
      for (const { options, env, extendEnv } of cases) {
        let seen: ChildProcess.CommandOptions | undefined;
        const spawner = makeChildHomeSpawner({
          homeDir: MATE_HOME,
          inheritedHome: PROCESS_HOME,
          inner: ChildProcessSpawner.make((command) => {
            if (ChildProcess.isStandardCommand(command)) seen = command.options;
            return Effect.die("spawned");
          }),
        });
        yield* Effect.exit(
          Effect.scoped(spawner.spawn(ChildProcess.make("git", ["status"], options))),
        );
        expect({ env: seen?.env, extendEnv: seen?.extendEnv }).toEqual({ env, extendEnv });
      }
    }),
);

// witness: apps/server/src/process/childHome.ts | if (homeDir === inheritedHome) return inner; → if (inheritedHome === undefined) return inner;
it.effect(
  "CH2: A Mate whose home is the server's own home spawns its children exactly as the platform does",
  () =>
    Effect.gen(function* () {
      let seen: ChildProcess.CommandOptions | undefined;
      const spawner = makeChildHomeSpawner({
        homeDir: PROCESS_HOME,
        inheritedHome: PROCESS_HOME,
        inner: ChildProcessSpawner.make((command) => {
          if (ChildProcess.isStandardCommand(command)) seen = command.options;
          return Effect.die("spawned");
        }),
      });
      yield* Effect.exit(Effect.scoped(spawner.spawn(ChildProcess.make("git", ["status"], {}))));
      expect({ env: seen?.env, extendEnv: seen?.extendEnv }).toEqual({
        env: undefined,
        extendEnv: undefined,
      });
    }),
);

// witness: apps/server/src/zerops/ExecService.ts | if (!isZeropsEnvironment(config)) { → if (isZeropsEnvironment(config)) {
it.effect(
  "CH3: Outside a Zerops project the server refuses to run a command as unavailable, and nothing is started",
  () =>
    Effect.gen(function* () {
      const runner = recordingRunner(Effect.succeed(ran));
      const outcome = yield* Effect.result(
        runExecCommand({ command: "node", args: ["-e", ""] }),
      ).pipe(
        Effect.provide(runner.layer),
        Effect.provideService(ServerConfig.ServerConfig, {
          cwd: "/srv/workspace",
          zerops: undefined,
        } as never),
      );
      assert.isTrue(Result.isFailure(outcome));
      if (Result.isFailure(outcome)) {
        assert.instanceOf(outcome.failure, ExecError);
        assert.strictEqual(outcome.failure.reason, "unavailable");
      }
      assert.strictEqual(runner.calls.length, 0);
    }),
);

// witness: apps/server/src/zerops/ExecService.ts | if (timeoutMs > EXEC_MAX_TIMEOUT_MS) { → if (input.timeoutMs === undefined && timeoutMs > EXEC_MAX_TIMEOUT_MS) {
it.effect(
  "CH4: A command may run for at most 600 seconds: a longer deadline is refused before anything is started",
  () =>
    Effect.gen(function* () {
      const runner = recordingRunner(Effect.succeed(ran));
      const outcome = yield* Effect.result(
        runExecCommand({ command: "node", args: ["-e", ""], timeoutMs: 600_001 }),
      ).pipe(
        Effect.provide(runner.layer),
        Effect.provideService(ServerConfig.ServerConfig, zeropsConfig as never),
      );
      assert.isTrue(Result.isFailure(outcome));
      if (Result.isFailure(outcome)) {
        assert.instanceOf(outcome.failure, ExecError);
        assert.strictEqual(outcome.failure.reason, "invalid_timeout");
      }
      assert.strictEqual(runner.calls.length, 0);
    }),
);

// witness: apps/server/src/zerops/ExecService.ts | args: input.args ?? [], → args: (input.args ?? []).join(" ").split(" "),
it.effect(
  "CH5: A command's arguments reach the process as the list the caller gave, so shell metacharacters arrive as one opaque argument",
  () =>
    Effect.gen(function* () {
      const injection = "; echo pwned | tee /dev/null";
      const args = ["-e", "process.stdout.write(process.argv[1] ?? 'none')", injection];
      const runner = recordingRunner(Effect.succeed(ran));
      yield* runExecCommand({ command: "node", args }).pipe(
        Effect.provide(runner.layer),
        Effect.provideService(ServerConfig.ServerConfig, zeropsConfig as never),
      );
      assert.strictEqual(runner.calls.length, 1);
      assert.strictEqual(runner.calls[0]?.command, "node");
      assert.deepStrictEqual(runner.calls[0]?.args, [
        "-e",
        "process.stdout.write(process.argv[1] ?? 'none')",
        "; echo pwned | tee /dev/null",
      ]);
    }),
);

// witness: apps/server/src/zerops/ExecService.ts | cwd: input.cwd ?? config.cwd, → cwd: input.cwd,
it.effect("CH6: A command with no working directory runs in the workspace root", () =>
  Effect.gen(function* () {
    const runner = recordingRunner(Effect.succeed(ran));
    yield* runExecCommand({
      command: "node",
      args: ["-e", "process.stdout.write(process.cwd())"],
    }).pipe(
      Effect.provide(runner.layer),
      Effect.provideService(ServerConfig.ServerConfig, zeropsConfig as never),
    );
    assert.strictEqual(runner.calls.length, 1);
    assert.strictEqual(runner.calls[0]?.cwd, "/srv/workspace");
  }),
);

// witness: apps/server/src/zerops/ExecService.ts | outputMode: "truncate", → outputMode: "error",
it.effect(
  "CH7: A command runs under a 60-second deadline unless its caller names one, a passed deadline is a timed-out result, and each output stream is cut at 1 MiB rather than refused",
  () =>
    Effect.gen(function* () {
      const runner = recordingRunner(Effect.succeed(ran));
      yield* runExecCommand({
        command: "node",
        args: ["-e", "process.stdout.write('x'.repeat(4 * 1024 * 1024))"],
      }).pipe(
        Effect.provide(runner.layer),
        Effect.provideService(ServerConfig.ServerConfig, zeropsConfig as never),
      );
      assert.strictEqual(runner.calls.length, 1);
      const call = runner.calls[0];
      assert.isDefined(call?.timeout);
      if (call?.timeout !== undefined) {
        assert.strictEqual(Duration.toMillis(call.timeout), 60_000);
      }
      assert.strictEqual(call?.timeoutBehavior, "timedOutResult");
      assert.strictEqual(call?.maxOutputBytes, 1_048_576);
      assert.strictEqual(call?.outputMode, "truncate");
    }),
);

// witness: apps/server/src/zerops/ExecService.ts | Effect.fail(new ExecError({ reason: "spawn_failed", detail: cause.message })), → Effect.fail(new ExecError({ reason: "unavailable", detail: cause.message })),
it.effect(
  "CH8: A command that exits non-zero is a result carrying its exit code and error output, never an error, and one that cannot be started at all is refused as a spawn failure",
  () =>
    Effect.gen(function* () {
      const failing = recordingRunner(
        Effect.succeed({ ...ran, code: ChildProcessSpawner.ExitCode(3), stderr: "it went wrong" }),
      );
      const { result } = yield* runExecCommand({
        command: "node",
        args: ["-e", "process.stderr.write('it went wrong'); process.exit(3)"],
      }).pipe(
        Effect.provide(failing.layer),
        Effect.provideService(ServerConfig.ServerConfig, zeropsConfig as never),
      );
      assert.strictEqual(result.exitCode, 3);
      assert.strictEqual(result.stderr, "it went wrong");

      const unstartable = recordingRunner(
        Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: "definitely-not-a-real-binary-9f3a",
            argumentCount: 0,
            cwd: "/srv/workspace",
            cause: new Error("spawn definitely-not-a-real-binary-9f3a ENOENT"),
          }),
        ),
      );
      const outcome = yield* Effect.result(
        runExecCommand({ command: "definitely-not-a-real-binary-9f3a", args: [] }),
      ).pipe(
        Effect.provide(unstartable.layer),
        Effect.provideService(ServerConfig.ServerConfig, zeropsConfig as never),
      );
      assert.isTrue(Result.isFailure(outcome));
      if (Result.isFailure(outcome)) {
        assert.instanceOf(outcome.failure, ExecError);
        assert.strictEqual(outcome.failure.reason, "spawn_failed");
      }
    }),
);
