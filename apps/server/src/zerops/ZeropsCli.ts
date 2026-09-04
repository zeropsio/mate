/**
 * The process seam between the mate server and the `zcp` binary.
 *
 * One call: `markAgentOAuth` — `zcp agent mark-oauth <agent>`, spawned once
 * per verified agent login (spec §0 Boundaries: the closed touchpoint list).
 * It is the only `zcp` argv the mate server ever runs.
 *
 * This module runs one attempt and reports what happened.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { parseMarkAgentOAuthOutput, type MarkAgentOAuthResult } from "./zeropsAgentAuthParse.ts";

/** The binary `zcp init` installs on every Zerops container. */
const ZCP_COMMAND = "zcp";
const MARK_OAUTH_TIMEOUT = Duration.seconds(15);
/** The output is one short JSON line; the cap only guards a pathological answer. */
const MARK_OAUTH_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * `zcp` is not installed — this is not a Zerops environment. Distinct from
 * {@link ZeropsCliFailed} on purpose: absence switches the feed off for good,
 * whereas a failure is retried. Conflating them would either spam a non-Zerops
 * user with errors or make a transient auth blip permanent.
 */
export class ZeropsCliNotFound extends Schema.TaggedErrorClass<ZeropsCliNotFound>()(
  "ZeropsCliNotFound",
  { command: Schema.String },
) {
  override get message(): string {
    return `The ${this.command} binary is not available`;
  }
}

/** `zcp` ran and did not answer usefully — a non-zero exit, or output we cannot read. */
export class ZeropsCliFailed extends Schema.TaggedErrorClass<ZeropsCliFailed>()("ZeropsCliFailed", {
  command: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.command} failed: ${this.reason}`;
  }
}

export type ZeropsCliError = ZeropsCliNotFound | ZeropsCliFailed;

export interface ZeropsCliOptions {
  readonly command: string;
  /** Arguments before the subcommand. Empty for the real binary. */
  readonly baseArgs: ReadonlyArray<string>;
  /** Where zcp resolves its project credentials from — `/var/www` in the container. */
  readonly cwd: string;
}

export class ZeropsCli extends Context.Service<
  ZeropsCli,
  {
    /**
     * Runs `zcp agent mark-oauth <agent-id>` — the platform-flag half of the
     * §3 W-STATE auth matrix (docs/spec-welcome-mode.md §4 W-AUTH). Never
     * prints or receives a credential value, only the flag key it upserted.
     */
    readonly markAgentOAuth: (
      agentId: string,
    ) => Effect.Effect<MarkAgentOAuthResult, ZeropsCliError>;
  }
>()("t3/zerops/ZeropsCli") {}

const isFileNotFound = (cause: unknown): boolean => {
  if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
    return true;
  }
  return typeof cause === "string" && cause.includes("ENOENT");
};

/** A spawn that failed because the binary is absent, versus any other spawn failure. */
const spawnErrorToCliError = (command: string, cause: unknown): ZeropsCliError =>
  isFileNotFound(cause) || isFileNotFound((cause as { cause?: unknown })?.cause)
    ? new ZeropsCliNotFound({ command })
    : new ZeropsCliFailed({ command, reason: String(cause) });

/** The first line of stderr, which is where `agent mark-oauth` puts its diagnostic. */
const firstDiagnosticLine = (stderr: string, fallback: string): string => {
  const line = stderr.split("\n").find((entry) => entry.trim().length > 0);
  return line === undefined ? fallback : line.trim();
};

export const make = (options: ZeropsCliOptions) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const { command, baseArgs, cwd } = options;

    const markAgentOAuth = (agentId: string): Effect.Effect<MarkAgentOAuthResult, ZeropsCliError> =>
      processRunner
        .run({
          command,
          args: [...baseArgs, "agent", "mark-oauth", agentId],
          cwd,
          timeout: MARK_OAUTH_TIMEOUT,
          maxOutputBytes: MARK_OAUTH_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        })
        .pipe(
          Effect.mapError((cause): ZeropsCliError =>
            cause._tag === "ProcessSpawnError"
              ? spawnErrorToCliError(command, cause.cause)
              : new ZeropsCliFailed({ command, reason: cause.message }),
          ),
          Effect.flatMap((result) => {
            if (result.code !== 0) {
              return Effect.fail(
                new ZeropsCliFailed({
                  command,
                  reason: firstDiagnosticLine(
                    result.stderr,
                    `agent mark-oauth exited ${result.code}`,
                  ),
                }),
              );
            }
            const parsed = parseMarkAgentOAuthOutput(result.stdout);
            return parsed === undefined
              ? Effect.fail(
                  new ZeropsCliFailed({
                    command,
                    reason: firstDiagnosticLine(
                      result.stderr,
                      "agent mark-oauth did not print a result document",
                    ),
                  }),
                )
              : Effect.succeed(parsed);
          }),
        );

    return { markAgentOAuth } satisfies ZeropsCli["Service"];
  });

/**
 * The real binary, run from the server's cwd — `/var/www` in the container,
 * which is where zcp resolves the project's credentials from.
 */
export const layer = Layer.effect(
  ZeropsCli,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return yield* make({ command: ZCP_COMMAND, baseArgs: [], cwd: config.cwd });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
