import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Run one command in the environment's container and report how it went.
 *
 * `args` is a list, never a shell string: nothing here composes a command line,
 * so quoting is not a category of bug this can have. There is no shell, so no
 * pipes, redirection or globbing either - a caller that wants those runs a
 * shell explicitly as the command.
 */
export const ExecRunInput = Schema.Struct({
  command: TrimmedNonEmptyString,
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Defaults to the environment's workspace root. */
  cwd: Schema.optionalKey(TrimmedNonEmptyString),
  timeoutMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type ExecRunInput = typeof ExecRunInput.Type;

export const ExecRunResult = Schema.Struct({
  /** Null when the command was killed rather than exiting on its own. */
  exitCode: Schema.NullOr(Schema.Int),
  stdout: Schema.String,
  stderr: Schema.String,
  /** True when the deadline killed it; stdout and stderr are then empty. */
  timedOut: Schema.Boolean,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
});
export type ExecRunResult = typeof ExecRunResult.Type;

export const ExecErrorReason = Schema.Literals([
  /** This environment does not offer command execution. */
  "unavailable",
  /** The command could not be started at all. */
  "spawn_failed",
  /** The deadline asked for is outside what this environment allows. */
  "invalid_timeout",
]);
export type ExecErrorReason = typeof ExecErrorReason.Type;

export class ExecError extends Schema.TaggedError<ExecError>()("ExecError", {
  reason: ExecErrorReason,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
