/**
 * The process seam between the mate server and the `zcp` binary.
 *
 * `mateStatus` / `mateUpdate` — `zcp mate status` / `zcp mate update`
 * (spec-mate.md §2.9). The platform "agent signed in" flag is no longer
 * written by spawning `zcp` (the old `agent mark-oauth` call) — see
 * {@link ../ZeropsAgentFlag.ts}, which writes it directly through the
 * Zerops API with the Mate's own key.
 *
 * This module runs one attempt and reports what happened.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { LeaseReleaseResult } from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  parseMateStatusOutput,
  parseMateUpdateOutput,
  type MateStatusResult,
  type MateUpdateResult,
} from "./zeropsMateUpdateParse.ts";

/** The binary `zcp init` installs on every Zerops container. */
const ZCP_COMMAND = "zcp";
/** `mate status` only reads a cached manifest (spec-mate.md §2.1c). */
const MATE_STATUS_TIMEOUT = Duration.seconds(15);
const MATE_STATUS_MAX_OUTPUT_BYTES = 64 * 1024;
/** `mate update` downloads a release and runs npm install — MD-13's staged-then-activated path. */
const MATE_UPDATE_TIMEOUT = Duration.minutes(5);
const MATE_UPDATE_MAX_OUTPUT_BYTES = 256 * 1024;
/**
 * `lease release` reads each lease's container over ssh for unsaved work (starting a parked one
 * first) before it releases any: minutes at worst, never an unbounded wait.
 */
const LEASE_RELEASE_TIMEOUT = Duration.minutes(3);
const LEASE_RELEASE_MAX_OUTPUT_BYTES = 256 * 1024;
/** `lease release`'s exit when a lease of the branch is kept: nothing was released. */
const LEASE_RELEASE_REFUSED_EXIT = 3;
/**
 * The first zcp release with `lease release`. An older zcp starts its MCP server on a verb it does
 * not know, so it is never asked: its version (`zcp version`) is read first.
 */
export const ZCP_LEASE_RELEASE_SINCE = "9.223.0";
/** `zcp version` prints one line and reads nothing. */
const VERSION_TIMEOUT = Duration.seconds(15);
const VERSION_MAX_OUTPUT_BYTES = 4 * 1024;

/** `zcp vX.Y.Z (…)`'s X.Y.Z; a dev build's `-N-g<sha>` reads as the release it was cut after. */
const versionOf = (stdout: string): ReadonlyArray<number> | undefined => {
  const match = /^zcp v?(\d+)\.(\d+)\.(\d+)/u.exec(stdout.trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
};

/** Whether `version` is at least `since`; an unreadable version is too old. */
export const zcpAtLeast = (version: string | undefined, since: string): boolean => {
  const have = version === undefined ? undefined : versionOf(`zcp v${version}`);
  const want = versionOf(`zcp v${since}`);
  if (have === undefined || want === undefined) return false;
  for (let index = 0; index < want.length; index++) {
    if (have[index]! !== want[index]!) return have[index]! > want[index]!;
  }
  return true;
};

const LeaseReleaseAnswer = Schema.Union([
  Schema.Struct({
    released: Schema.Array(Schema.Struct({ lease: Schema.String, outcome: Schema.String })),
  }),
  Schema.Struct({
    refused: Schema.Array(
      Schema.Struct({
        lease: Schema.String,
        unsaved: Schema.optionalKey(
          Schema.Struct({
            files: Schema.Array(Schema.String),
            commits: Schema.Array(Schema.String),
          }),
        ),
        inUse: Schema.optionalKey(Schema.Struct({ sessions: Schema.Number })),
      }),
    ),
  }),
  Schema.Struct({ error: Schema.String }),
]);
const decodeLeaseReleaseAnswer = Schema.decodeUnknownOption(
  Schema.fromJsonString(LeaseReleaseAnswer),
);

/** zcp's answer: the last line of its stdout that reads as one, past any notice printed before. */
const lastAnswer = (stdout: string) => {
  const lines = stdout.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const answer = decodeLeaseReleaseAnswer(lines[index]!.trim());
    if (Option.isSome(answer)) return answer;
  }
  return Option.none<typeof LeaseReleaseAnswer.Type>();
};

/** A release not made in words the server chose: what zcp wrote beside its answer is never kept. */
const releaseFailed = (reason: string): LeaseReleaseResult => ({ outcome: "failed", reason });
const TOO_OLD = releaseFailed("this zcp can't release yet");

/**
 * `zcp` is not installed — this is not a Zerops environment. Distinct from
 * {@link ZeropsCliFailed} on purpose: absence switches the feed off for good,
 * whereas a failure is retried. Conflating them would either spam a non-Zerops
 * user with errors or make a transient auth blip permanent.
 */
export class ZeropsCliNotFound extends Schema.TaggedError<ZeropsCliNotFound>()(
  "ZeropsCliNotFound",
  { command: Schema.String },
) {
  override get message(): string {
    return `The ${this.command} binary is not available`;
  }
}

/** `zcp` ran and did not answer usefully — a non-zero exit, or output we cannot read. */
export class ZeropsCliFailed extends Schema.TaggedError<ZeropsCliFailed>()("ZeropsCliFailed", {
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
  /** How long `lease release` is waited on; {@link LEASE_RELEASE_TIMEOUT} unless a test says. */
  readonly leaseReleaseTimeout?: Duration.Input;
}

export class ZeropsCli extends Context.Service<
  ZeropsCli,
  {
    /**
     * Runs `zcp mate status --json` (spec-mate.md §2.9): the one place that
     * compares an installed mate with the stable manifest. Never installs.
     * Tolerates an `error` field in the answer — a degraded-but-successful
     * result, not a failure of this call.
     */
    readonly mateStatus: (options?: {
      /**
       * Appends `--refresh` to re-read the release manifest now instead of
       * serving the hourly cache (spec-mate.md §2.9 step 2, "on demand").
       * `zcp mate status` ignores unknown flags (`slices.Contains`), so no
       * capability probe is needed before sending it.
       */
      readonly refresh?: boolean;
      readonly local?: boolean;
    }) => Effect.Effect<MateStatusResult, ZeropsCliError>;
    /**
     * Runs `zcp mate update --json` (spec-mate.md §2.9 MU-2). Its JSON is
     * returned even on a non-zero exit — a failed update is a successful
     * call to this method, never a {@link ZeropsCliFailed}.
     */
    readonly mateUpdate: (options?: {
      readonly automatic?: boolean;
    }) => Effect.Effect<MateUpdateResult, ZeropsCliError>;
    /**
     * Runs `zcp version`: the installed zcp's `X.Y.Z` (a dev build's prefix), or none when it
     * printed nothing this server reads, or did not run.
     */
    readonly version: Effect.Effect<string | undefined>;
    /**
     * Runs `zcp lease release --branch <branch> [--repo <url>] --json` with stdin closed: every
     * lease of the branch released, never forced — zcp refuses (exit 3) while a lease of it holds
     * uncommitted or untracked files or commits on no remote branch, or another live zcp session
     * holds it, and names them. A zcp older than {@link ZCP_LEASE_RELEASE_SINCE} is never asked.
     * Always a result: a zcp that fails, is missing, or does not answer in time reads `failed`, in
     * zcp's own `error` or a fixed phrase.
     */
    readonly leaseRelease: (input: {
      readonly branch: string;
      readonly repo?: string;
    }) => Effect.Effect<LeaseReleaseResult>;
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

/** The first line of stderr, which is where a failed `zcp` subcommand puts its diagnostic. */
const firstDiagnosticLine = (stderr: string, fallback: string): string => {
  const line = stderr.split("\n").find((entry) => entry.trim().length > 0);
  return line === undefined ? fallback : line.trim();
};

export const make = (options: ZeropsCliOptions) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const { command, baseArgs, cwd } = options;

    const mateStatus = (options?: {
      readonly refresh?: boolean;
      readonly local?: boolean;
    }): Effect.Effect<MateStatusResult, ZeropsCliError> =>
      processRunner
        .run({
          command,
          args: [
            ...baseArgs,
            "mate",
            "status",
            "--json",
            ...(options?.refresh ? ["--refresh"] : []),
            ...(options?.local ? ["--local"] : []),
          ],
          cwd,
          timeout: MATE_STATUS_TIMEOUT,
          maxOutputBytes: MATE_STATUS_MAX_OUTPUT_BYTES,
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
                  reason: firstDiagnosticLine(result.stderr, `mate status exited ${result.code}`),
                }),
              );
            }
            const parsed = parseMateStatusOutput(result.stdout);
            return parsed === undefined
              ? Effect.fail(
                  new ZeropsCliFailed({
                    command,
                    reason: firstDiagnosticLine(
                      result.stderr,
                      "mate status did not print a result document",
                    ),
                  }),
                )
              : Effect.succeed(parsed);
          }),
        );

    // A failed `mate update` is a successful call to this method (spec-mate.md
    // §2.9 MU-2): the exit code is read only to help pick the diagnostic when
    // there is no parseable JSON at all, never to fail the Effect on its own.
    const mateUpdate = (options?: {
      readonly automatic?: boolean;
    }): Effect.Effect<MateUpdateResult, ZeropsCliError> =>
      processRunner
        .run({
          command,
          args: [
            ...baseArgs,
            "mate",
            "update",
            "--json",
            ...(options?.automatic ? ["--automatic"] : []),
          ],
          cwd,
          timeout: MATE_UPDATE_TIMEOUT,
          maxOutputBytes: MATE_UPDATE_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        })
        .pipe(
          Effect.mapError((cause): ZeropsCliError =>
            cause._tag === "ProcessSpawnError"
              ? spawnErrorToCliError(command, cause.cause)
              : new ZeropsCliFailed({ command, reason: cause.message }),
          ),
          Effect.flatMap((result) => {
            const parsed = parseMateUpdateOutput(result.stdout);
            return parsed === undefined
              ? Effect.fail(
                  new ZeropsCliFailed({
                    command,
                    reason: firstDiagnosticLine(
                      result.stderr,
                      `mate update did not print a result document (exited ${result.code})`,
                    ),
                  }),
                )
              : Effect.succeed(parsed);
          }),
        );

    const version: Effect.Effect<string | undefined> = processRunner
      .run({
        command,
        args: [...baseArgs, "version"],
        cwd,
        stdin: "",
        timeout: VERSION_TIMEOUT,
        maxOutputBytes: VERSION_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((result) =>
          result.code === 0 ? versionOf(result.stdout)?.join(".") : undefined,
        ),
        Effect.orElseSucceed(() => undefined),
      );

    // Read until a zcp that can release is found, then never again: zcp updates in place under a
    // running server, so an older one is asked again at the next archive.
    let canRelease = false;
    const ableToRelease = Effect.suspend(() =>
      canRelease
        ? Effect.succeed(true)
        : Effect.map(version, (installed) => {
            canRelease = zcpAtLeast(installed, ZCP_LEASE_RELEASE_SINCE);
            return canRelease;
          }),
    );

    const leaseReleaseTimeout = options.leaseReleaseTimeout ?? LEASE_RELEASE_TIMEOUT;
    const release = (input: {
      readonly branch: string;
      readonly repo?: string;
    }): Effect.Effect<LeaseReleaseResult> =>
      processRunner
        .run({
          command,
          args: [
            ...baseArgs,
            "lease",
            "release",
            "--branch",
            input.branch,
            ...(input.repo === undefined ? [] : ["--repo", input.repo]),
            "--json",
          ],
          cwd,
          // Closed: nothing zcp starts on this call ever waits for input.
          stdin: "",
          timeout: leaseReleaseTimeout,
          maxOutputBytes: LEASE_RELEASE_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        })
        .pipe(
          Effect.map((result): LeaseReleaseResult => {
            const answer = lastAnswer(result.stdout);
            if (Option.isSome(answer)) {
              const read = answer.value;
              if ("released" in read && result.code === 0) {
                return { outcome: "released", leases: read.released };
              }
              if ("refused" in read && result.code === LEASE_RELEASE_REFUSED_EXIT) {
                return { outcome: "refused", leases: read.refused };
              }
              if ("error" in read) return releaseFailed(read.error);
            }
            return releaseFailed("zcp gave no answer to read");
          }),
          Effect.catch((cause) =>
            Effect.succeed(
              cause._tag === "ProcessTimeoutError"
                ? releaseFailed(
                    `zcp did not answer the release within ${Duration.toMillis(Duration.fromInputUnsafe(leaseReleaseTimeout)) / 1000} s`,
                  )
                : cause._tag === "ProcessSpawnError" &&
                    spawnErrorToCliError(command, cause.cause)._tag === "ZeropsCliNotFound"
                  ? releaseFailed("zcp is not installed here")
                  : releaseFailed("zcp could not be run"),
            ),
          ),
        );

    const leaseRelease = (input: {
      readonly branch: string;
      readonly repo?: string;
    }): Effect.Effect<LeaseReleaseResult> =>
      Effect.flatMap(ableToRelease, (able) => (able ? release(input) : Effect.succeed(TOO_OLD)));

    return {
      mateStatus,
      mateUpdate,
      version,
      leaseRelease,
    } satisfies ZeropsCli["Service"];
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
