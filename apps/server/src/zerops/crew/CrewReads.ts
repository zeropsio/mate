/**
 * CrewReads - what the engine reads off a dev service, over `CrewShell`, to
 * record for the snapshot and to fill a card: at a moment the engine already
 * works on the service (Apply, turn end, a landing, a press), and whether
 * landed work went out when the crew's landed work is read (its boot, a feed
 * opened, *Ask to ship*), bounded and kept per landing.
 *
 * - **Topology** at Apply: the service's `zerops.yaml` (its crew ports) and
 *   whether its ssh environment reaches a database. The environment never
 *   leaves the service: the check runs there and prints one word.
 * - **Your tree**: its branch and HEAD (*Changes* diffs `<head>..crew/<handle>`).
 * - **A lane against your tree**: commits ahead, insertions and deletions
 *   (`HEAD...crew/<handle>`), whether the copy holds uncommitted work, and the
 *   lane's commits since its task started, for a new stint's seed.
 * - **Your tree**: its dirty paths (*Deliver*'s draft names them) and which
 *   landings went out: a landing commit whose patch is on a branch of the
 *   tree's origin (HQ, which every push goes through), by patch identity, so
 *   work rebased or cherry-picked onto a branch of the Mate's own counts.
 * - **A crewmate's changes** for `crew_diff`, cut to what a tool answer carries.
 * - **A page of a writer's own app** for `crew_open_app`, fetched on the writer's service.
 *
 * @module CrewReads
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { laneBranch, laneDirectory } from "./crewLanes.ts";
import {
  CrewGitError,
  CrewShell,
  field,
  fields,
  fieldsOf,
  git,
  runFields,
  script,
  shellVariable,
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

/** What a `crew_open_app` answer carries of a page at most. */
export const PAGE_MAX_CHARS = 40_000;

/** A page of a writer's own app, as its service fetched it from the app's port. */
export interface AppPage {
  /** Its HTTP status; `null` when nothing answered. */
  readonly status: number | null;
  readonly contentType: string;
  /** Its body, cut at {@link PAGE_MAX_CHARS}. */
  readonly body: string;
  /** Why nothing answered, in curl's words; `"curl"` when the service has no curl. */
  readonly failure: string;
}

/** The line between a page's fields and its body. */
const PAGE_BODY = "\n--- page ---\n";

/**
 * Names and values that mean the service's environment reaches a database:
 * a connection URL of a database engine, or a conventional variable.
 */
const DATABASE_ENV_PATTERN =
  "^(DATABASE_URL|DB_URL|DB_HOST|DB_HOSTNAME|POSTGRES_HOST|MYSQL_HOST|MONGO_URL|MONGODB_URI)=|=(postgres|postgresql|mysql|mariadb|mongodb|mongodb\\+srv)://";

const READ_TIMEOUT = Duration.seconds(30);

/** How long a shipped read starts new landings for, inside its {@link READ_TIMEOUT}. */
const SHIPPED_BUDGET = Duration.seconds(20);

/** How many of the origin's branches, newest first, a landing's patch is looked for on. */
export const SHIPPED_BRANCHES_MAX = 50;

/** A full commit id, the only thing a shipped read puts in its script. */
const COMMIT_ID = /^[0-9a-f]{40,64}$/u;

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
  /**
   * Of the given landing commits, those it could read (`read`), and those whose patch a branch of
   * the tree's origin holds (`shipped`): the commit itself, or one with the same patch (`git
   * cherry`) on a branch whose tip is no older than the landing commit — a branch that took the
   * patch moved since it was made — at most {@link SHIPPED_BRANCHES_MAX} of them, newest first.
   * Landings are read in the order given while its budget lasts; one it did not reach, or that
   * the remote timeout cut, is not read.
   */
  readonly shipped: (
    host: string,
    commits: ReadonlyArray<string>,
  ) => Effect.Effect<
    { readonly read: ReadonlySet<string>; readonly shipped: ReadonlySet<string> },
    CrewReadError
  >;
  /** A crewmate's changes against your tree, optionally one path. */
  readonly diff: (
    host: string,
    handle: string,
    path: string | undefined,
  ) => Effect.Effect<string, CrewReadError>;
  /** A hash of the lockfiles in a lane, so a merge-in that moves one reruns setup. */
  readonly lockfileHash: (host: string, handle: string) => Effect.Effect<string, CrewReadError>;
  /**
   * A page of the app a writer runs from its copy, fetched on its own service from the app's port,
   * so it answers wherever the copy lives: a dev service or a pool's lease.
   */
  readonly openApp: (
    host: string,
    port: number,
    path: string,
  ) => Effect.Effect<AppPage, CrewReadError>;
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

  const shipped: CrewReadsService["shipped"] = (host, commits) => {
    const landings = commits.filter((commit) => COMMIT_ID.test(commit));
    if (landings.length === 0) return Effect.succeed({ read: new Set(), shipped: new Set() });
    const c = shellVariable("c");
    const ref = shellVariable("ref");
    const seconds = Duration.toSeconds(SHIPPED_BUDGET);
    // Landing by landing, in the order given: each one's verdict is printed once it is whole, and
    // none starts past the budget, so what came before a slow one is kept.
    const body =
      `deadline=$(( $(date +%s) + ${seconds} ))\n` +
      `for c in ${landings.map(shellQuote).join(" ")}; do\n` +
      `  [ "$(date +%s)" -lt "$deadline" ] || break\n` +
      // A commit the tree does not hold is not read: nothing is claimed of it.
      `  made=$(${git("integration", ["log", "-1", "--format=%ct", c])} 2>/dev/null) || continue\n` +
      `  if [ -n "$(${git("integration", ["for-each-ref", "--count=1", "--contains", c, "refs/remotes/origin"])} 2>/dev/null)" ]; then\n` +
      `    printf 'read\\t%s\\nshipped\\t%s\\n' "$c" "$c"; continue\n` +
      `  fi\n` +
      `  verdict=no; whole=yes\n` +
      `  for ref in $(${git("integration", ["for-each-ref", "--sort=-committerdate", `--count=${SHIPPED_BRANCHES_MAX}`, "--format=%(committerdate:unix) %(refname)", "refs/remotes/origin"])} | awk -v made="$made" '$1 >= made && $2 !~ /\\/HEAD$/ { print $2 }'); do\n` +
      `    if [ "$(date +%s)" -ge "$deadline" ]; then whole=no; break; fi\n` +
      `    out=$(${git("integration", ["cherry", ref, c, shellVariable("c^")])} 2>/dev/null) || continue\n` +
      `    case "$out" in "+"*) ;; *) verdict=yes; break ;; esac\n` +
      `  done\n` +
      `  [ "$whole" = yes ] || break\n` +
      `  printf 'read\\t%s\\n' "$c"\n` +
      `  [ "$verdict" = no ] || printf 'shipped\\t%s\\n' "$c"\n` +
      `done\n`;
    // What it printed stands whatever its exit: a timeout keeps the landings read before it.
    return shell.run(host, script(body), { timeout: READ_TIMEOUT }).pipe(
      Effect.map((result) => {
        const out = fields(result.stdout);
        return { read: new Set(fieldsOf(out, "read")), shipped: new Set(fieldsOf(out, "shipped")) };
      }),
    );
  };

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

  const openApp: CrewReadsService["openApp"] = (host, port, path) =>
    shell
      .run(
        host,
        script(
          `command -v curl >/dev/null 2>&1 || { printf 'failure\\tcurl\\n'; exit 0; }\n` +
            `page=$(mktemp) && err=$(mktemp) || exit 1\n` +
            `curl -sS --max-time 20 -o "$page" -w 'status\\t%{http_code}\\ncontent\\t%{content_type}\\n' ${shellQuote(`http://127.0.0.1:${port}${path}`)} 2>"$err"\n` +
            `printf 'failure\\t%s' "$(head -n 1 "$err" | tr '\\t' ' ')"\n` +
            `printf ${shellQuote(PAGE_BODY.replaceAll("\n", "\\n"))}\n` +
            `head -c ${PAGE_MAX_CHARS + 1} "$page"\n` +
            `rm -f "$page" "$err"\n`,
        ),
        { timeout: READ_TIMEOUT },
      )
      .pipe(
        Effect.flatMap((result) => {
          if (result.code !== 0) {
            return Effect.fail(
              new CrewGitError({
                host,
                operation: "openApp",
                detail: result.stderr.trim() || `exit ${result.code}`,
              }),
            );
          }
          const split = result.stdout.indexOf(PAGE_BODY);
          const head = fields(split === -1 ? result.stdout : result.stdout.slice(0, split));
          const body = split === -1 ? "" : result.stdout.slice(split + PAGE_BODY.length);
          const status = Number(field(head, "status") ?? 0);
          return Effect.succeed({
            status: status > 0 ? status : null,
            contentType: field(head, "content") ?? "",
            body:
              body.length > PAGE_MAX_CHARS
                ? `${body.slice(0, PAGE_MAX_CHARS)}\n… cut at ${PAGE_MAX_CHARS} characters.`
                : body,
            failure: field(head, "failure") ?? "",
          });
        }),
      );

  return CrewReads.of({
    openApp,
    zeropsYaml,
    reachesDatabase,
    integration,
    laneStats,
    laneLog,
    dirtyPaths,
    shipped,
    diff,
    lockfileHash,
  });
});

export const layer = Layer.effect(CrewReads, make);
