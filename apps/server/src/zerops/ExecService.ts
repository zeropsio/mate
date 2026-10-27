/**
 * ExecService - run one command in the container and report how it went.
 *
 * This is the operator's replacement for reaching into the container over SSH:
 * a script, or a person driving the client, asks the environment to run
 * something and reads back the exit code and the output. It is deliberately
 * the smallest thing that does that job - one command, one result, no session,
 * no pty. The terminal RPCs already exist for interactive work.
 *
 * Two properties are structural rather than defended:
 *
 * - `args` is a list handed to the spawner. Nothing composes a command line,
 *   so quoting is not a category of bug this can have, and there is no shell to
 *   interpret metacharacters. A caller that wants a pipeline runs a shell
 *   explicitly as the command, which is then their choice and visible as such.
 * - it answers only inside a Zerops project. Elsewhere the environment reports
 *   that it does not offer command execution, so adding this capability changes
 *   nothing for an ordinary `t3 serve`. The scope that reaches it
 *   (`exec:operate`) is likewise granted only by the Zerops identity door,
 *   where the caller is a project member who can already open a shell in this
 *   container by other means.
 *
 * @module zerops/ExecService
 */
import { ExecError, type ExecRunInput, type ExecRunResult } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";

/** Applied when the caller names no deadline. */
export const EXEC_DEFAULT_TIMEOUT_MS = 60_000;

/** The longest deadline a caller may ask for. */
export const EXEC_MAX_TIMEOUT_MS = 600_000;

/**
 * Per stream. Output is truncated rather than refused: a caller that asked for
 * a build log wants the log it can have, with the fact of the cut reported,
 * not an error instead of output.
 */
export const EXEC_MAX_OUTPUT_BYTES = 1024 * 1024;

export const runExecCommand = Effect.fn("Zerops.exec.run")(function* (input: ExecRunInput) {
  const config = yield* ServerConfig.ServerConfig;
  if (!isZeropsEnvironment(config)) {
    return yield* new ExecError({
      reason: "unavailable",
      detail: "This environment does not offer command execution.",
    });
  }
  const timeoutMs = input.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS;
  if (timeoutMs > EXEC_MAX_TIMEOUT_MS) {
    return yield* new ExecError({
      reason: "invalid_timeout",
      detail: `A command may run for at most ${String(EXEC_MAX_TIMEOUT_MS)} ms.`,
    });
  }

  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner
    .run({
      command: input.command,
      args: input.args ?? [],
      cwd: input.cwd ?? config.cwd,
      timeout: Duration.millis(timeoutMs),
      timeoutBehavior: "timedOutResult",
      maxOutputBytes: EXEC_MAX_OUTPUT_BYTES,
      outputMode: "truncate",
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new ExecError({
            reason: "spawn_failed",
            detail: cause.message,
          }),
      ),
    );

  return {
    exitCode: output.code,
    stdout: output.stdout,
    stderr: output.stderr,
    timedOut: output.timedOut,
    stdoutTruncated: output.stdoutTruncated,
    stderrTruncated: output.stderrTruncated,
  } satisfies ExecRunResult;
});
