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
import { LeaseAlias, type LeaseReleaseResult } from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  parseMateStatusOutput,
  parseMateUpdateOutput,
  type MateStatusResult,
  type MateUpdateResult,
} from "./zeropsMateUpdateParse.ts";
import { zcpVersionText } from "./zcpVersion.ts";

/** The binary `zcp init` installs on every Zerops container. */
const ZCP_COMMAND = "zcp";
/** `mate status` reads the release source once; `--local` answers without a network call. */
const MATE_STATUS_TIMEOUT = Duration.seconds(15);
const MATE_STATUS_MAX_OUTPUT_BYTES = 64 * 1024;
/** `mate update` downloads a release and runs npm install — MD-13's staged-then-activated path. */
const MATE_UPDATE_TIMEOUT = Duration.minutes(5);
const MATE_UPDATE_MAX_OUTPUT_BYTES = 256 * 1024;
/** DP-39 reserves for up to 600 s and waits up to 20 s for warm work after answering. */
const LEASE_ACQUIRE_TIMEOUT = Duration.seconds(630);
export const ZCP_LEASE_ACQUIRE_SINCE = "9.271.0";
/**
 * `lease release` reads each lease's container over ssh for unsaved work (starting a parked one
 * first) before it releases any: minutes at worst, never an unbounded wait.
 */
const LEASE_RELEASE_TIMEOUT = Duration.minutes(3);
const LEASE_MAX_OUTPUT_BYTES = 256 * 1024;
/** zcp reserved or released nothing. */
const LEASE_REFUSED_EXIT = 3;
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
const zcpAtLeast = (version: string | undefined, since: string): boolean => {
  const have = version === undefined ? undefined : versionOf(`zcp v${zcpVersionText(version)}`);
  const want = versionOf(`zcp v${zcpVersionText(since)}`);
  if (have === undefined || want === undefined) return false;
  for (let index = 0; index < want.length; index++) {
    if (have[index]! !== want[index]!) return have[index]! > want[index]!;
  }
  return true;
};

const Unsaved = Schema.Struct({
  files: Schema.Array(Schema.String),
  commits: Schema.Array(Schema.String),
});
const ReleasedLeases = Schema.Array(
  Schema.Struct({ lease: Schema.String, outcome: Schema.String }),
);
// An error first: zcp's exit 1 may also list the leases it did release before it failed.
const LeaseReleaseAnswer = Schema.Union([
  Schema.Struct({ error: Schema.String, released: Schema.optionalKey(ReleasedLeases) }),
  Schema.Struct({ released: ReleasedLeases }),
  Schema.Struct({
    refused: Schema.Array(
      Schema.Struct({
        lease: Schema.String,
        unsaved: Schema.optionalKey(Unsaved),
        inUse: Schema.optionalKey(Schema.Struct({ sessions: Schema.Number })),
      }),
    ),
  }),
]);
const decodeLeaseReleaseAnswer = Schema.decodeUnknownOption(
  Schema.fromJsonString(LeaseReleaseAnswer),
);

const CopyReleaseRefusal = Schema.Struct({ lease: Schema.String, unsaved: Unsaved });
const decodeCopyReleaseAnswer = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ error: Schema.String }),
      Schema.Struct({
        released: Schema.Array(
          Schema.Struct({
            lease: Schema.String,
            outcome: Schema.Literals(["kept-warm", "removed", "reset", "lost"]),
          }),
        ),
      }),
      Schema.Struct({ refused: Schema.NonEmptyArray(CopyReleaseRefusal) }),
    ]),
  ),
);

type CopyReleaseResult =
  | { readonly outcome: "released" | "ended" }
  | { readonly outcome: "refused"; readonly leases: ReadonlyArray<typeof CopyReleaseRefusal.Type> }
  | { readonly outcome: "failed"; readonly reason: string };

const LeaseAcquireAnswer = Schema.Union([
  Schema.Struct({
    lease: Schema.Struct({
      id: Schema.NonEmptyString,
      alias: LeaseAlias,
      pool: Schema.String,
      branch: Schema.String,
      repo: Schema.String,
      acquiredAt: Schema.String,
      containerHostname: Schema.String,
    }),
    reused: Schema.Boolean,
  }),
  Schema.Struct({
    refused: Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      suggestion: Schema.String,
    }),
  }),
  Schema.Struct({ error: Schema.String }),
]);
const decodeLeaseAcquireAnswer = Schema.decodeUnknownOption(
  Schema.fromJsonString(LeaseAcquireAnswer),
);

/** Withdrawal belongs to the conversation, before it invokes zcp. */
type CliReleaseResult = Exclude<LeaseReleaseResult, { readonly outcome: "withdrawn" }>;

type LeaseAcquireResult =
  | { readonly outcome: "acquired"; readonly alias: string; readonly leaseId: string }
  | { readonly outcome: "refused" | "failed"; readonly detail: string };

/** zcp's answer: the last line of its stdout that reads as one, past any notice printed before. */
const lastAnswer = <A>(stdout: string, decode: (line: string) => Option.Option<A>) => {
  const lines = stdout.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const answer = decode(lines[index]!.trim());
    if (Option.isSome(answer)) return answer;
  }
  return Option.none<A>();
};

/** A release not made in words the server chose: what zcp wrote beside its answer is never kept. */
const releaseFailed = (reason: string) => ({ outcome: "failed", reason }) as const;
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
       * Appends `--local`: answers from zcp's last read of the release source
       * without a network call. Without it every status reads the source.
       */
      readonly local?: boolean;
    }) => Effect.Effect<MateStatusResult, ZeropsCliError>;
    /**
     * Runs `zcp mate update --json` (spec-mate.md §2.9 MU-2). Its JSON is
     * returned even on a non-zero exit — a failed update is a successful
     * call to this method, never a {@link ZeropsCliFailed}.
     */
    readonly mateUpdate: () => Effect.Effect<MateUpdateResult, ZeropsCliError>;
    /** DP-39: acquire or reuse the pool's default repository on this branch without a session. */
    readonly leaseAcquire: (input: {
      readonly pool: string;
      readonly branch: string;
    }) => Effect.Effect<LeaseAcquireResult>;
    /** DP-40: release one writer's holding, including its record after platform loss. */
    readonly leaseReleaseCopy: (input: {
      readonly leaseId: string;
    }) => Effect.Effect<CopyReleaseResult>;
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
    }) => Effect.Effect<CliReleaseResult>;
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
      readonly local?: boolean;
    }): Effect.Effect<MateStatusResult, ZeropsCliError> =>
      processRunner
        .run({
          command,
          args: [...baseArgs, "mate", "status", "--json", ...(options?.local ? ["--local"] : [])],
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
    const mateUpdate = (): Effect.Effect<MateUpdateResult, ZeropsCliError> =>
      processRunner
        .run({
          command,
          args: [...baseArgs, "mate", "update", "--json"],
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

    // `zcp version`: the installed zcp's `X.Y.Z` (a dev build's prefix), or none when it printed
    // nothing this server reads, or did not run.
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

    // zcp updates in place: remember a supported verb, and recheck an older binary next time.
    const supports = (since: string) => {
      let supported = false;
      return Effect.suspend(() =>
        supported
          ? Effect.succeed(true)
          : Effect.map(version, (installed) => {
              supported = zcpAtLeast(installed, since);
              return supported;
            }),
      );
    };
    const ableToRelease = supports(ZCP_LEASE_RELEASE_SINCE);
    const ableToAcquire = supports(ZCP_LEASE_ACQUIRE_SINCE);

    const leaseAcquire: ZeropsCli["Service"]["leaseAcquire"] = ({ pool, branch }) =>
      Effect.gen(function* (): Effect.fn.Return<LeaseAcquireResult> {
        if (!(yield* ableToAcquire))
          return {
            outcome: "refused",
            detail: `A writer on a pool needs zcp ${ZCP_LEASE_ACQUIRE_SINCE} or later.`,
          };
        const result = yield* processRunner
          .run({
            command,
            args: [...baseArgs, "lease", "acquire", "--pool", pool, "--branch", branch, "--json"],
            cwd,
            stdin: "",
            timeout: LEASE_ACQUIRE_TIMEOUT,
            maxOutputBytes: LEASE_MAX_OUTPUT_BYTES,
            outputMode: "truncate",
          })
          .pipe(Effect.result);
        if (result._tag === "Failure") return { outcome: "failed", detail: result.failure.message };
        const { stdout, code, stderr } = result.success;
        const read = Option.getOrUndefined(lastAnswer(stdout, decodeLeaseAcquireAnswer));
        if (
          code === 0 &&
          read &&
          "lease" in read &&
          read.lease.pool === pool &&
          read.lease.alias.startsWith(`${pool}-`) &&
          read.lease.branch === branch
        ) {
          return { outcome: "acquired", alias: read.lease.alias, leaseId: read.lease.id };
        }
        if (code === LEASE_REFUSED_EXIT && read && "refused" in read) {
          return {
            outcome: "refused",
            detail: [read.refused.message, read.refused.suggestion].filter(Boolean).join(" "),
          };
        }
        return {
          outcome: "failed",
          detail:
            read && "error" in read
              ? read.error
              : firstDiagnosticLine(stderr, "zcp gave no acquire answer to read"),
        };
      });

    const leaseReleaseTimeout = options.leaseReleaseTimeout ?? LEASE_RELEASE_TIMEOUT;
    const runRelease = (args: ReadonlyArray<string>) =>
      processRunner
        .run({
          command,
          args: [...baseArgs, "lease", "release", ...args, "--json"],
          cwd,
          stdin: "",
          timeout: leaseReleaseTimeout,
          maxOutputBytes: LEASE_MAX_OUTPUT_BYTES,
          outputMode: "truncate",
        })
        .pipe(
          Effect.mapError((cause) =>
            cause._tag === "ProcessTimeoutError"
              ? releaseFailed(
                  `zcp did not answer the release within ${Duration.toMillis(Duration.fromInputUnsafe(leaseReleaseTimeout)) / 1000} s`,
                )
              : cause._tag === "ProcessSpawnError" &&
                  spawnErrorToCliError(command, cause.cause)._tag === "ZeropsCliNotFound"
                ? releaseFailed("zcp is not installed here")
                : releaseFailed("zcp could not be run"),
          ),
        );

    const leaseReleaseCopy: ZeropsCli["Service"]["leaseReleaseCopy"] = ({ leaseId }) =>
      Effect.gen(function* (): Effect.fn.Return<CopyReleaseResult> {
        if (!(yield* ableToAcquire))
          return releaseFailed(
            `Releasing a writer's copy needs zcp ${ZCP_LEASE_ACQUIRE_SINCE} or later.`,
          );
        const run = yield* runRelease(["--lease-id", leaseId]).pipe(Effect.result);
        if (run._tag === "Failure") return run.failure;
        const { stdout, code } = run.success;
        const read = Option.getOrUndefined(lastAnswer(stdout, decodeCopyReleaseAnswer));
        if (code === 0 && read && "released" in read && read.released.length <= 1) {
          const entry = read.released[0];
          return {
            outcome: entry === undefined || entry.outcome === "lost" ? "ended" : "released",
          };
        }
        if (code === LEASE_REFUSED_EXIT && read && "refused" in read)
          return { outcome: "refused", leases: read.refused };
        return releaseFailed(
          read && "error" in read
            ? read.error.replaceAll(leaseId, "[lease id]")
            : "zcp gave no answer to read",
        );
      });

    const release = (input: {
      readonly branch: string;
      readonly repo?: string;
    }): Effect.Effect<CliReleaseResult> =>
      runRelease([
        "--branch",
        input.branch,
        ...(input.repo === undefined ? [] : ["--repo", input.repo]),
      ]).pipe(
        Effect.map((result): CliReleaseResult => {
          const answer = lastAnswer(result.stdout, decodeLeaseReleaseAnswer);
          if (Option.isSome(answer)) {
            const read = answer.value;
            if ("released" in read && result.code === 0) {
              return { outcome: "released", leases: read.released };
            }
            if ("refused" in read && result.code === LEASE_REFUSED_EXIT) {
              return { outcome: "refused", leases: read.refused };
            }
            if ("error" in read) {
              return read.released === undefined || read.released.length === 0
                ? releaseFailed(read.error)
                : { outcome: "failed", reason: read.error, released: read.released };
            }
          }
          return releaseFailed("zcp gave no answer to read");
        }),
        Effect.catch(Effect.succeed),
      );

    const leaseRelease = (input: {
      readonly branch: string;
      readonly repo?: string;
    }): Effect.Effect<CliReleaseResult> =>
      Effect.flatMap(ableToRelease, (able) =>
        able ? release(input) : Effect.succeed<CliReleaseResult>(TOO_OLD),
      );

    return {
      mateStatus,
      mateUpdate,
      leaseAcquire,
      leaseReleaseCopy,
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
