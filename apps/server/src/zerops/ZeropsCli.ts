/**
 * The process seam between the mate server and the `zcp` binary.
 *
 * Two calls, both read-only:
 *
 * - `readTopology` — a short-lived `zcp studio topology`, a direct (non-search)
 *   read of the project's services.
 * - `watchDoorbell` — the long-lived `zcp studio watch`, which rides the
 *   platform websocket and prints NDJSON `{"type":…}` when the project's service
 *   LIST changes. It is a doorbell, not a data feed: it carries no topology and
 *   never fires on a status transition, so every event means "re-read".
 *
 * This module runs one attempt and reports what happened; restart policy,
 * polling and publishing belong to {@link ZeropsTopology}.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { parseMarkAgentOAuthOutput, type MarkAgentOAuthResult } from "./zeropsAgentAuthParse.ts";
import { parseZeropsTopology, type ZeropsTopologyRead } from "./zeropsTopologyParse.ts";

/** The binary `zcp init` installs on every Zerops container. */
const ZCP_COMMAND = "zcp";
const TOPOLOGY_TIMEOUT = Duration.seconds(20);
/** One read of a small project is ~0.26 s; the cap only guards a pathological answer. */
const TOPOLOGY_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
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

/**
 * `zcp studio watch`'s whole vocabulary (`internal/dataconsole/watch/watch.go`):
 * `connected`, `topology-changed`, `disconnected`. Read as an open string so an
 * event kind added later reaches the caller instead of being dropped here.
 */
export interface ZeropsDoorbellEvent {
  readonly type: string;
}

export interface ZeropsCliOptions {
  readonly command: string;
  /** Arguments before the studio subcommand. Empty for the real binary. */
  readonly baseArgs: ReadonlyArray<string>;
  /** Where zcp resolves its project credentials from — `/var/www` in the container. */
  readonly cwd: string;
}

export class ZeropsCli extends Context.Service<
  ZeropsCli,
  {
    readonly readTopology: Effect.Effect<ZeropsTopologyRead, ZeropsCliError>;
    /**
     * Runs one `zcp studio watch` attempt, calling `onEvent` per doorbell ring,
     * and completes when the child exits. Never restarts on its own.
     */
    readonly watchDoorbell: (
      onEvent: (event: ZeropsDoorbellEvent) => Effect.Effect<void>,
    ) => Effect.Effect<void, ZeropsCliError>;
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

/** One doorbell line, or undefined when it is not one. Never throws. */
const readDoorbellLine = (line: string): ZeropsDoorbellEvent | undefined => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const type = (parsed as { type?: unknown }).type;
  return typeof type === "string" ? { type } : undefined;
};

/** The first line of stderr, which is where every studio verb puts its diagnostic. */
const firstDiagnosticLine = (stderr: string, fallback: string): string => {
  const line = stderr.split("\n").find((entry) => entry.trim().length > 0);
  return line === undefined ? fallback : line.trim();
};

export const make = (options: ZeropsCliOptions) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const { command, baseArgs, cwd } = options;

    const readTopology: Effect.Effect<ZeropsTopologyRead, ZeropsCliError> = processRunner
      .run({
        command,
        args: [...baseArgs, "studio", "topology"],
        cwd,
        timeout: TOPOLOGY_TIMEOUT,
        maxOutputBytes: TOPOLOGY_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(
          (cause): ZeropsCliError =>
            cause._tag === "ProcessSpawnError"
              ? spawnErrorToCliError(command, cause.cause)
              : new ZeropsCliFailed({ command, reason: cause.message }),
        ),
        Effect.flatMap((result) => {
          if (result.code !== 0) {
            return Effect.fail(
              new ZeropsCliFailed({
                command,
                reason: firstDiagnosticLine(result.stderr, `studio topology exited ${result.code}`),
              }),
            );
          }
          const topology = parseZeropsTopology(result.stdout);
          return topology === undefined
            ? Effect.fail(
                new ZeropsCliFailed({
                  command,
                  reason: firstDiagnosticLine(
                    result.stderr,
                    "studio topology did not print a topology document",
                  ),
                }),
              )
            : Effect.succeed(topology);
        }),
      );

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
          Effect.mapError(
            (cause): ZeropsCliError =>
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

    const watchDoorbell = (
      onEvent: (event: ZeropsDoorbellEvent) => Effect.Effect<void>,
    ): Effect.Effect<void, ZeropsCliError> =>
      Effect.scoped(
        Effect.gen(function* () {
          const child = ChildProcess.make(command, [...baseArgs, "studio", "watch"], {
            cwd,
            // `zcp studio watch` cancels itself when stdin reaches EOF, so an
            // orphaned watcher can never outlive its parent
            // (`cmd/zcp/studio.go:302-305`). That makes an open stdin pipe part
            // of the contract, not an optimisation: close it and the child dies
            // at spawn.
            stdin: { stream: "pipe", endOnDone: false },
            stdout: "pipe",
            stderr: "pipe",
            killSignal: "SIGTERM",
            forceKillAfter: Duration.seconds(2),
          });

          const handle = yield* Effect.acquireRelease(
            spawner
              .spawn(child)
              .pipe(Effect.mapError((cause) => spawnErrorToCliError(command, cause))),
            (spawned) => spawned.kill().pipe(Effect.ignore),
          );

          // Diagnostics only; draining keeps the pipe from filling and stalling
          // the child.
          yield* handle.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);

          // Lines are decoded one at a time rather than through an NDJSON
          // channel: that channel FAILS on the first unreadable line, which
          // would silence the doorbell for the rest of the child's life over a
          // single stray write or a half-line left by a kill. A doorbell that
          // stops ringing is invisible — the map would just quietly stop
          // updating. Here an unreadable line is skipped and the next ring
          // still arrives.
          yield* handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) => {
              const event = readDoorbellLine(line);
              return event === undefined ? Effect.void : onEvent(event);
            }),
            Effect.mapError(
              (cause) => new ZeropsCliFailed({ command, reason: `studio watch: ${String(cause)}` }),
            ),
          );
        }),
      );

    return { readTopology, watchDoorbell, markAgentOAuth } satisfies ZeropsCli["Service"];
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
