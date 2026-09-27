/**
 * CrewReads - what the engine reads off a dev service, over `CrewShell`, to
 * record for the snapshot and to fill a card: never at subscribe time, always
 * at a moment the engine already works on the service (Apply, turn end, a
 * landing, a press).
 *
 * - **Topology** at Apply: the service's `zerops.yaml` (its crew ports) and
 *   whether its ssh environment reaches a database. The environment never
 *   leaves the service: the check runs there and prints one word.
 * - **Your tree**: its branch and HEAD (*Changes* diffs `<head>..crew/<handle>`).
 * - **A lane against your tree**: commits ahead, insertions and deletions
 *   (`HEAD...crew/<handle>`), whether the copy holds uncommitted work, and the
 *   lane's commits since its task started, for a new stint's seed.
 * - **Your tree**: its dirty paths (*Deliver*'s draft names them) and which
 *   landing commits a remote branch already holds (delivered).
 * - **The dev server** zcp started on the service (`DEV_SERVER_PIDFILE`,
 *   written by `zerops_dev_server` before it execs the command): its command
 *   line, which a shaped turn restarts it with.
 * - **A crewmate's changes** for `crew_diff`, cut to what a tool answer carries.
 *
 * @module CrewReads
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { DEV_SERVER_PIDFILE } from "./CrewRuntime.ts";
import {
  CrewShell,
  field,
  fieldsOf,
  git,
  laneBranch,
  laneDirectory,
  runFields,
  script,
  type CrewGitError,
  type CrewShellError,
} from "./CrewShell.ts";

export type CrewReadError = CrewShellError | CrewGitError;

/** Your tree on a service: its branch (`null` when detached) and HEAD. */
export interface Integration {
  readonly branch: string | null;
  readonly head: string;
}

export interface LaneStats {
  readonly ahead: number;
  readonly insertions: number;
  readonly deletions: number;
  /** The copy holds work no commit has yet: what a lane commit would take, or an open merge. */
  readonly dirty: boolean;
  /** Your tree as the figures were read against it. */
  readonly integration: Integration;
}

/** What a `crew_diff` answer carries at most. */
export const DIFF_MAX_CHARS = 40_000;

/**
 * Names and values that mean the service's environment reaches a database:
 * a connection URL of a database engine, or a conventional variable.
 */
const DATABASE_ENV_PATTERN =
  "^(DATABASE_URL|DB_URL|DB_HOST|DB_HOSTNAME|POSTGRES_HOST|MYSQL_HOST|MONGO_URL|MONGODB_URI)=|=(postgres|postgresql|mysql|mariadb|mongodb|mongodb\\+srv)://";

const READ_TIMEOUT = Duration.seconds(30);

export interface CrewReadsService {
  /** `zerops.yaml` (or `zerops.yml`) of the service's tree; undefined when it has none. */
  readonly zeropsYaml: (host: string) => Effect.Effect<string | undefined, CrewReadError>;
  readonly reachesDatabase: (host: string) => Effect.Effect<boolean, CrewReadError>;
  /** Your tree's branch and HEAD. */
  readonly integration: (host: string) => Effect.Effect<Integration, CrewReadError>;
  readonly laneStats: (host: string, handle: string) => Effect.Effect<LaneStats, CrewReadError>;
  /** `git log --oneline` of the lane since `since`, newest first, at most 20. */
  readonly laneLog: (
    host: string,
    handle: string,
    since: string | null,
  ) => Effect.Effect<ReadonlyArray<string>, CrewReadError>;
  /** Your tree's uncommitted paths, relative to it. */
  readonly dirtyPaths: (host: string) => Effect.Effect<ReadonlyArray<string>, CrewReadError>;
  /** The given commits some remote-tracking branch already contains. */
  readonly delivered: (
    host: string,
    commits: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlySet<string>, CrewReadError>;
  /** The command line of the dev server zcp started, if one runs. */
  readonly devServerCommand: (host: string) => Effect.Effect<string | undefined, CrewReadError>;
  /** A crewmate's changes against your tree, optionally one path. */
  readonly diff: (
    host: string,
    handle: string,
    path: string | undefined,
  ) => Effect.Effect<string, CrewReadError>;
  /** A hash of the lockfiles in a lane, so a merge-in that moves one reruns setup. */
  readonly lockfileHash: (host: string, handle: string) => Effect.Effect<string, CrewReadError>;
}

export class CrewReads extends Context.Service<CrewReads, CrewReadsService>()(
  "t3/zerops/crew/CrewReads",
) {}

const LOCKFILE_PATHSPECS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "go.sum",
  "Cargo.lock",
  "mix.lock",
].map((name) => `:(glob)**/${name}`);

export const make = Effect.gen(function* () {
  const shell = yield* CrewShell;
  const read = (host: string, operation: string, body: string) =>
    runFields(shell, host, operation, body, READ_TIMEOUT);

  const zeropsYaml: CrewReadsService["zeropsYaml"] = (host) =>
    shell
      .run(
        host,
        script(`for f in zerops.yaml zerops.yml; do [ -f "$f" ] && exec cat "$f"; done; exit 3\n`),
        {
          timeout: READ_TIMEOUT,
        },
      )
      .pipe(Effect.map((result) => (result.code === 0 ? result.stdout : undefined)));

  const reachesDatabase: CrewReadsService["reachesDatabase"] = (host) =>
    read(
      host,
      "reachesDatabase",
      `if env | grep -qiE ${shellQuote(DATABASE_ENV_PATTERN)}; then printf 'database\\tyes\\n'; else printf 'database\\tno\\n'; fi\n`,
    ).pipe(Effect.map((out) => field(out, "database") === "yes"));

  /** Prints `branch` and `head` of your tree. */
  const INTEGRATION_SCRIPT =
    `printf 'branch\\t%s\\n' "$(${git("integration", ["symbolic-ref", "-q", "--short", "HEAD"])})"\n` +
    `printf 'head\\t%s\\n' "$(${git("integration", ["rev-parse", "HEAD"])})"\n`;

  const integrationOf = (out: ReadonlyArray<readonly [string, string]>): Integration => {
    const branch = field(out, "branch") ?? "";
    return { branch: branch === "" ? null : branch, head: field(out, "head") ?? "" };
  };

  const integration: CrewReadsService["integration"] = (host) =>
    read(host, "integration", INTEGRATION_SCRIPT).pipe(Effect.map(integrationOf));

  const laneStats: CrewReadsService["laneStats"] = (host, handle) => {
    const range = `HEAD...refs/heads/${laneBranch(handle)}`;
    return read(
      host,
      "laneStats",
      INTEGRATION_SCRIPT +
        `ahead=$(${git("integration", ["rev-list", "--count", `HEAD..refs/heads/${laneBranch(handle)}`])}) || exit 1\n` +
        `printf 'ahead\\t%s\\n' "$ahead"\n` +
        `${git("integration", ["diff", "--numstat", range])} | awk '{ i += $1; d += $2 } END { printf "insertions\\t%d\\ndeletions\\t%d\\n", i, d }'\n` +
        `dirty=no\n` +
        `if [ -d ${shellQuote(laneDirectory(handle))} ]; then\n` +
        `  if ${git({ lane: handle }, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])} >/dev/null || [ -n "$(${git({ lane: handle }, ["status", "--porcelain"])})" ]; then dirty=yes; fi\n` +
        `fi\n` +
        `printf 'dirty\\t%s\\n' "$dirty"\n`,
    ).pipe(
      Effect.map((out) => ({
        ahead: Number(field(out, "ahead") ?? 0),
        insertions: Number(field(out, "insertions") ?? 0),
        deletions: Number(field(out, "deletions") ?? 0),
        dirty: field(out, "dirty") === "yes",
        integration: integrationOf(out),
      })),
    );
  };

  const laneLog: CrewReadsService["laneLog"] = (host, handle, since) =>
    read(
      host,
      "laneLog",
      `${git({ lane: handle }, ["log", "--oneline", "-20", since === null ? "HEAD" : `${since}..HEAD`])} | sed 's/^/commit\t/'\n`,
    ).pipe(Effect.map((out) => fieldsOf(out, "commit")));

  const dirtyPaths: CrewReadsService["dirtyPaths"] = (host) =>
    read(
      host,
      "dirtyPaths",
      `${git("integration", ["status", "--porcelain", "--untracked-files=all"])} | cut -c4- | sed 's/^/path\t/'\n`,
    ).pipe(Effect.map((out) => fieldsOf(out, "path").filter((path) => !path.startsWith(".crew/"))));

  const delivered: CrewReadsService["delivered"] = (host, commits) =>
    commits.length === 0
      ? Effect.succeed(new Set())
      : read(
          host,
          "delivered",
          commits
            .map(
              (commit) =>
                `[ -n "$(${git("integration", ["branch", "-r", "--contains", commit])} 2>/dev/null)" ] && printf 'delivered\\t%s\\n' ${shellQuote(commit)}\n`,
            )
            .join("") + "true\n",
        ).pipe(Effect.map((out) => new Set(fieldsOf(out, "delivered"))));

  const devServerCommand: CrewReadsService["devServerCommand"] = (host) =>
    read(
      host,
      "devServerCommand",
      `pid=$(cat ${shellQuote(DEV_SERVER_PIDFILE)} 2>/dev/null) || exit 0\n` +
        `case "$pid" in ''|*[!0-9]*) exit 0 ;; esac\n` +
        `kill -0 "$pid" 2>/dev/null || exit 0\n` +
        `command=$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || command=$(ps -o command= -p "$pid")\n` +
        `printf 'command\\t%s\\n' "$(printf '%s' "$command" | sed 's/ *$//')"\n`,
    ).pipe(
      Effect.map((out) => {
        const command = field(out, "command")?.trim();
        return command === undefined || command === "" ? undefined : command;
      }),
    );

  const diff: CrewReadsService["diff"] = (host, handle, path) =>
    shell
      .run(
        host,
        git("integration", [
          "diff",
          "--stat",
          "--patch",
          `HEAD...refs/heads/${laneBranch(handle)}`,
          ...(path === undefined ? [] : ["--", path]),
        ]),
        { timeout: READ_TIMEOUT },
      )
      .pipe(
        Effect.map((result) => {
          const text = result.code === 0 ? result.stdout : result.stderr.trim();
          return text.length > DIFF_MAX_CHARS
            ? `${text.slice(0, DIFF_MAX_CHARS)}\n… cut at ${DIFF_MAX_CHARS} characters; name a path to see the rest.`
            : text;
        }),
      );

  const lockfileHash: CrewReadsService["lockfileHash"] = (host, handle) =>
    read(
      host,
      "lockfileHash",
      `[ -d ${shellQuote(laneDirectory(handle))} ] || { printf 'hash\\t\\n'; exit 0; }\n` +
        `printf 'hash\\t%s\\n' "$(${git({ lane: handle }, ["ls-files", "-s", "--", ...LOCKFILE_PATHSPECS])} | cksum | cut -d' ' -f1)"\n`,
    ).pipe(Effect.map((out) => field(out, "hash") ?? ""));

  return CrewReads.of({
    zeropsYaml,
    reachesDatabase,
    integration,
    laneStats,
    laneLog,
    dirtyPaths,
    delivered,
    devServerCommand,
    diff,
    lockfileHash,
  });
});

export const layer = Layer.effect(CrewReads, make);
