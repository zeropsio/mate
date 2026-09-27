/**
 * CrewShell - the only way crew code reaches a dev service.
 *
 * Every crew git call, setup, check and app runs on the service that owns the
 * repository, over ssh, never against the sshfs mount and never through
 * `ChildProcessSpawner` or `vcs/**` (MG-2). A script runs with its cwd at the
 * repository's `remotePath`, so crew scripts name lanes relatively
 * (`.crew/<handle>`) and never spell `/var/www`.
 *
 * - **Verified hosts only.** A host resolves to a repository whose project and
 *   service ids were verified; the ids are re-checked in the same remote shell
 *   (`identityGuard`) before anything runs, so a reused hostname never
 *   receives a crew write.
 * - **Bounded.** The remote side runs under `timeout -k`, the local ssh under
 *   a slightly longer one; at most {@link MAX_CREW_SESSIONS_PER_HOST} crew
 *   sessions per host at a time, beside the git spawner's own pool.
 * - **Every git write carries the crew identity and Mate's durable-write
 *   settings** ({@link git}): identity per invocation with `-c`, never written
 *   to config (zcp `ops/git_identity.go`), and `core.fsync=objects,reference`
 *   with `core.fsyncMethod=fsync` (`vcs/GitVcsDriver.ts` `durableWrite`), so an
 *   unclean restart leaves no 0-byte ref. `LC_ALL=C` keeps git's refusals in
 *   the words `classifyLandingRefusal` reads.
 *
 * @module CrewShell
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ProcessRunner from "../../processRunner.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../ZeropsRepositorySource.ts";
import { identityGuard, shellQuote, sshArguments } from "../ZeropsWorkspaceAccess.ts";

/** Crew ssh sessions per host (ARCHITECTURE §2); the git spawner keeps its own 4. */
export const MAX_CREW_SESSIONS_PER_HOST = 3;

/** Who every crew commit is by. */
export const CREW_GIT_IDENTITY = { name: "Zerops Mate Crew", email: "crew@zerops.io" } as const;

/** A shell fragment for a dev service; built only by {@link script} and {@link git}. */
export type CrewScript = string & { readonly CrewScript: unique symbol };

export const script = (text: string): CrewScript => text as CrewScript;

/** Where a git command runs: the integration tree (`remotePath`) or a crewmate's lane. */
export type GitAt = "integration" | { readonly lane: string };

/** A lane's directory, relative to `remotePath`. */
export const laneDirectory = (handle: string): string => `.crew/${handle}`;

/** A lane's branch. */
export const laneBranch = (handle: string): string => `crew/${handle}`;

const GIT_CONFIG: ReadonlyArray<string> = [
  "-c",
  `user.name=${CREW_GIT_IDENTITY.name}`,
  "-c",
  `user.email=${CREW_GIT_IDENTITY.email}`,
  "-c",
  "core.fsync=objects,reference",
  "-c",
  "core.fsyncMethod=fsync",
];

/** A word passed to the shell unquoted: a variable the script set (`"$H"`). */
export interface ShellVariable {
  readonly variable: string;
}

/** `"$name"` inside a {@link git} line. */
export const shellVariable = (name: string): ShellVariable => ({ variable: name });

/** One quoted git command line with the crew identity and the durable-write settings. */
export const git = (at: GitAt, args: ReadonlyArray<string | ShellVariable>): CrewScript =>
  script(
    [
      "LC_ALL=C git",
      ...[...(at === "integration" ? [] : ["-C", laneDirectory(at.lane)]), ...GIT_CONFIG].map(
        shellQuote,
      ),
      ...args.map((arg) => (typeof arg === "string" ? shellQuote(arg) : `"$${arg.variable}"`)),
    ].join(" "),
  );

/** Inherited git environment never steers a crew script. */
const PRELUDE =
  "unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES\n" +
  "export GIT_TERMINAL_PROMPT=0 GIT_NO_LAZY_FETCH=1\n";

/** Exit codes that are not the script's own. */
const SSH_TRANSPORT_EXIT_CODE = 255;
const IDENTITY_MISMATCH_EXIT_CODE = 126;
const WORKSPACE_MISSING_EXIT_CODE = 125;
const REMOTE_TIMEOUT_EXIT_CODE = 124;
const IDENTITY_MISMATCH_TEXT = "Mate remote workspace identity mismatch";
const WORKSPACE_MISSING_TEXT = "Mate crew workspace missing";

/** How long the local ssh outlives the remote `timeout`, so the remote one decides. */
const LOCAL_TIMEOUT_MARGIN = Duration.seconds(15);

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  /** The remote `timeout` stopped the script (exit 124). */
  readonly timedOut: boolean;
}

export interface CrewShellRunOptions {
  readonly timeout: Duration.Input;
  readonly stdin?: string | undefined;
}

export class CrewShellError extends Schema.TaggedError<CrewShellError>()("CrewShellError", {
  host: Schema.String,
  reason: Schema.Literals(["unverified", "identity", "workspace", "transport", "process"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Crew shell on '${this.host}' failed (${this.reason}): ${this.detail}`;
  }
}

/** A crew script that git refused in a way no outcome names. */
export class CrewGitError extends Schema.TaggedError<CrewGitError>()("CrewGitError", {
  host: Schema.String,
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Crew ${this.operation} on '${this.host}' failed: ${this.detail}`;
  }
}

/**
 * The `key<TAB>value` lines crew scripts print, in order. A value runs to the
 * end of its line; a key may repeat (one `path` line per path).
 */
export const fields = (stdout: string): ReadonlyArray<readonly [string, string]> =>
  stdout
    .split("\n")
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab === -1 ? undefined : ([line.slice(0, tab), line.slice(tab + 1)] as const);
    })
    .filter((entry) => entry !== undefined);

/** The first value of `key`, if any. */
export const field = (
  entries: ReadonlyArray<readonly [string, string]>,
  key: string,
): string | undefined => entries.find(([name]) => name === key)?.[1];

/** Every value of `key`, in order. */
export const fieldsOf = (
  entries: ReadonlyArray<readonly [string, string]>,
  key: string,
): ReadonlyArray<string> => entries.filter(([name]) => name === key).map(([, value]) => value);

/** Runs a crew script whose output is {@link fields}; a non-zero exit is a {@link CrewGitError}. */
export const runFields = (
  shell: CrewShellService,
  host: string,
  operation: string,
  body: string,
  timeout: Duration.Input,
  stdin?: string,
) =>
  shell.run(host, script(body), { timeout, stdin }).pipe(
    Effect.flatMap((result) =>
      result.code === 0
        ? Effect.succeed(fields(result.stdout))
        : Effect.fail(
            new CrewGitError({
              host,
              operation,
              detail: result.stderr.trim() || `exit ${result.code}`,
            }),
          ),
    ),
  );

export interface CrewShellService {
  readonly run: (
    host: string,
    script: CrewScript,
    options: CrewShellRunOptions,
  ) => Effect.Effect<ShellResult, CrewShellError>;
  /** The verified repository a host resolves to (`mountPath` for a stat through the mount). */
  readonly repository: (host: string) => Effect.Effect<ZeropsRepository, CrewShellError>;
}

export class CrewShell extends Context.Service<CrewShell, CrewShellService>()(
  "t3/zerops/crew/CrewShell",
) {}

export interface CrewShellOptions {
  readonly runner: ProcessRunner.ProcessRunner["Service"];
  /** Verified bindings; a host without one is refused. */
  readonly known: Effect.Effect<ReadonlyArray<ZeropsRepository>>;
}

export const makeCrewShell = (options: CrewShellOptions): CrewShellService => {
  const gates = new Map<string, Semaphore.Semaphore>();
  const gateFor = (host: string): Semaphore.Semaphore => {
    const existing = gates.get(host);
    if (existing !== undefined) return existing;
    const created = Semaphore.makeUnsafe(MAX_CREW_SESSIONS_PER_HOST);
    gates.set(host, created);
    return created;
  };

  const repository = (host: string) =>
    options.known.pipe(
      Effect.flatMap((known) => {
        const found = known.find((entry) => entry.host === host && entry.identity !== undefined);
        return found === undefined
          ? Effect.fail(
              new CrewShellError({
                host,
                reason: "unverified",
                detail: "no verified repository binding for this host",
              }),
            )
          : Effect.succeed(found);
      }),
    );

  const run: CrewShellService["run"] = (host, body, runOptions) =>
    Effect.gen(function* () {
      const target = yield* repository(host);
      const identity = target.identity!;
      const seconds = Math.max(
        1,
        Math.ceil(Duration.toSeconds(Duration.fromInputUnsafe(runOptions.timeout))),
      );
      const remote =
        `${identityGuard(identity)}` +
        `cd ${shellQuote(target.remotePath)} 2>/dev/null || ` +
        `{ printf '%s\\n' '${WORKSPACE_MISSING_TEXT}' >&2; exit ${WORKSPACE_MISSING_EXIT_CODE}; }; ` +
        `exec timeout -k 5 ${seconds} sh -c ${shellQuote(PRELUDE + body)}`;
      const output = yield* Semaphore.withPermits(
        gateFor(host),
        1,
      )(
        options.runner.run({
          command: "ssh",
          args: sshArguments(host, remote),
          timeout: Duration.sum(Duration.seconds(seconds), LOCAL_TIMEOUT_MARGIN),
          ...(runOptions.stdin === undefined ? {} : { stdin: runOptions.stdin }),
        }),
      ).pipe(
        Effect.mapError(
          (cause) => new CrewShellError({ host, reason: "process", detail: cause.message }),
        ),
      );
      const code = output.code ?? -1;
      if (code === SSH_TRANSPORT_EXIT_CODE) {
        return yield* new CrewShellError({
          host,
          reason: "transport",
          detail: output.stderr.trim(),
        });
      }
      if (code === IDENTITY_MISMATCH_EXIT_CODE && output.stderr.includes(IDENTITY_MISMATCH_TEXT)) {
        return yield* new CrewShellError({
          host,
          reason: "identity",
          detail: IDENTITY_MISMATCH_TEXT,
        });
      }
      if (code === WORKSPACE_MISSING_EXIT_CODE && output.stderr.includes(WORKSPACE_MISSING_TEXT)) {
        return yield* new CrewShellError({
          host,
          reason: "workspace",
          detail: `${target.remotePath} is missing on the service`,
        });
      }
      return {
        stdout: output.stdout,
        stderr: output.stderr,
        code,
        timedOut: code === REMOTE_TIMEOUT_EXIT_CODE,
      } satisfies ShellResult;
    });

  return { run, repository };
};

export const layer = Layer.effect(
  CrewShell,
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const source = yield* ZeropsRepositorySource;
    return CrewShell.of(makeCrewShell({ runner, known: source.known }));
  }),
);
