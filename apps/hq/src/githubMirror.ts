/**
 * A repository HQ mirrors to GitHub through the organization's app: GitHub's default branch is
 * upstream. HQ pushes its `main` to an empty repository, fast-forwards its own `main` to GitHub's
 * after a merge there, and pushes each open change's head to a branch of its own on GitHub, from
 * which `pullRequests.ts` keeps the change's pull request. GitHub's branches and tags follow into
 * HQ's copy under `refs/github/`, as GitHub has them; nothing there goes back.
 *
 * @module githubMirror
 */
import type { GitError, HqGit, MirrorRemote, Repo } from "@t3tools/hq-git";
import { COMPARE_COMMITS_MAX } from "@t3tools/shared/hqChanges";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { Changes } from "./changes.ts";
import { GithubAuth } from "./githubAuth.ts";
import { GithubEvents } from "./githubEvents.ts";
import { governanceOf } from "./githubProbes.ts";
import { GitHost, holdingRepo, mainOf } from "./gitHost.ts";
import { GitTransport, remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { MateTasks } from "./mateTasks.ts";

/** What following GitHub's default branch did. */
export type MirrorSync =
  /** Mate's `main` was pushed to an empty repository, or one behind it. */
  | { readonly kind: "pushed"; readonly sha: string }
  /** Mate's `main` moved to GitHub's: a merge or a push there. */
  | { readonly kind: "imported"; readonly from: string; readonly to: string }
  | { readonly kind: "same"; readonly sha: string }
  /** Neither contains the other: nothing moved, and the repository says so. */
  | { readonly kind: "diverged"; readonly mate: string; readonly github: string };

export class GithubMirrorUnavailable extends Data.TaggedError("GithubMirrorUnavailable")<{
  readonly reason: "not_mirrored" | "unreachable" | "refused" | "busy";
  readonly detail?: string;
}> {}

export class GithubMirror extends Context.Service<
  GithubMirror,
  {
    /** `owner/name` on GitHub that HQ's `repo` of `appId` mirrors to through the app, if any. */
    readonly repositoryOf: (
      appId: string,
      repo: string,
    ) => Effect.Effect<string | undefined, SqlError>;
    /**
     * Follow GitHub's default branch (see {@link MirrorSync}), then its other branches and tags
     * into `refs/github/`. Syncs of one repository coalesce: one runs, one waits, and whoever asks
     * meanwhile takes the waiting one's outcome.
     */
    readonly sync: (
      appId: string,
      repo: string,
    ) => Effect.Effect<MirrorSync, GithubMirrorUnavailable | SqlError>;
    /**
     * `sync` in the background, outliving whoever asked (a repository just connected): what it
     * finds shows on the repository (`diverged`), a failure is logged and tried again by the sweep.
     */
    readonly follow: (appId: string, repo: string) => Effect.Effect<void>;
    /**
     * Push the change's head to its branch on GitHub (`mate/<number>-<slug>`, named once); its
     * name and the sha pushed, or `undefined` where the change has no head or the repo no mirror.
     */
    readonly pushChange: (
      appId: string,
      repo: string,
      number: number,
    ) => Effect.Effect<
      { readonly branch: string; readonly sha: string } | undefined,
      GithubMirrorUnavailable | SqlError
    >;
    /** Ticks when a mirrored repository's governance on GitHub changed (`listRepos` reads it). */
    readonly changes: Stream.Stream<number>;
  }
>()("@t3tools/hq/githubMirror") {}

/** No mirror: nothing is mirrored through an app. Tests and HQs without an app. */
export const githubMirrorAbsentLayer = Layer.succeed(
  GithubMirror,
  GithubMirror.of({
    repositoryOf: () => Effect.succeed(undefined),
    sync: () => Effect.fail(new GithubMirrorUnavailable({ reason: "not_mirrored" })),
    pushChange: () => Effect.succeed(undefined),
    follow: () => Effect.void,
    changes: Stream.empty,
  }),
);

/**
 * A change's branch on GitHub: `mate/<number>-<its title's words>`, lower-case, at most 40
 * characters after the number, cut at a word.
 */
export const changeBranch = (number: number, title: string) => {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const cut = words.length <= 40 ? words : words.slice(0, 41).replace(/-[^-]*$/u, "");
  const slug = (cut === "" ? words.slice(0, 40) : cut).replace(/-+$/u, "");
  return `mate/${String(number)}-${slug === "" ? "change" : slug}`;
};

/** The GitHub login a commit's author address names: GitHub's noreply address, else none. */
const githubLogin = (email: string) =>
  /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/u.exec(email)?.[1];

/**
 * The open changes of `repo` whose head is not on GitHub yet — never one whose branch there
 * diverged while its head is still the one it diverged at.
 */
export const changesToPush = (sql: SqlClient.SqlClient, appId: string, repo: string) =>
  Effect.map(
    sql<{ readonly number: number }>`
      SELECT c.number FROM hq_change c
      LEFT JOIN hq_change_mirror m
        ON m.app_id = c.app_id AND m.repo = c.repo AND m.number = c.number
      WHERE c.app_id::text = ${appId} AND c.repo = ${repo} AND c.state = 'open'
        AND c.head IS NOT NULL AND c.head IS DISTINCT FROM m.pushed_sha
        AND c.head IS DISTINCT FROM m.diverged_head
      ORDER BY c.number`,
    (rows) => rows.map((row) => row.number),
  );

export interface GithubMirrorOptions {
  /**
   * The git address of the GitHub repository `owner/name`: GitHub's own by default; tests point it
   * at a local bare repository.
   */
  readonly gitUrl?: (repository: string) => string;
  /**
   * How often every mirrored repository follows GitHub again and its changes' pushes are tried
   * again — what a missed webhook or an unreachable GitHub left behind; a minute.
   */
  readonly sweepEvery?: Duration.Duration;
}

const unavailable = (reason: GithubMirrorUnavailable["reason"], detail?: string) =>
  new GithubMirrorUnavailable({ reason, ...(detail === undefined ? {} : { detail }) });

/** Git refusing or GitHub out of reach, as the mirror says it; never a path or a token. */
const fromGit = (error: GitError | NotLeader) =>
  error._tag === "NotLeader"
    ? unavailable("busy", "HQ does not lead")
    : unavailable(error.reason === "busy" ? "busy" : "unreachable", error.message);

/**
 * The mirror: through the organization's GitHub app, a repository's `main` follows GitHub's default
 * branch and its open changes' heads reach their branches there. It follows on every move of HQ's
 * git (`GitHost.moves`), on GitHub's pushes to any branch or tag (`GithubEvents`), and every
 * `sweepEvery`; a failure is logged and tried again on the next of these, never failing the push
 * or merge that asked for it.
 */
export const githubMirrorLayer = (
  options: GithubMirrorOptions = {},
): Layer.Layer<
  GithubMirror,
  never,
  | GitHost
  | GithubAuth
  | GithubEvents
  | GitTransport
  | Changes
  | MateTasks
  | Leader
  | SqlClient.SqlClient
> =>
  Layer.effect(
    GithubMirror,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const gitHost = yield* GitHost;
      const auth = yield* GithubAuth;
      const events = yield* GithubEvents;
      const transport = yield* GitTransport;
      const changes = yield* Changes;
      const tasks = yield* MateTasks;
      const gitUrl = options.gitUrl ?? ((repository) => `https://github.com/${repository}.git`);
      const services = yield* Effect.context<Leader | SqlClient.SqlClient>();
      const governed = yield* SubscriptionRef.make(0);

      /** One mirror operation at a time per repository or change: two pushes never race a lease. */
      const locks = new Map<string, Semaphore.Semaphore>();
      const serialized = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          let lock = locks.get(key);
          if (lock === undefined) {
            lock = Semaphore.makeUnsafe(1);
            locks.set(key, lock);
          }
          return Semaphore.withPermits(lock, 1)(effect);
        });
      const layerScope = yield* Effect.scope;
      /**
       * The sync of a repository that waits for the one running: whoever asks meanwhile joins it.
       * It runs on its own, so one asker that stops waiting stops none of the others.
       */
      const waiting = new Map<
        string,
        Deferred.Deferred<MirrorSync, GithubMirrorUnavailable | SqlError>
      >();
      const coalesced = (
        key: string,
        effect: Effect.Effect<MirrorSync, GithubMirrorUnavailable | SqlError>,
      ) =>
        Effect.suspend(() => {
          const queued = waiting.get(key);
          if (queued !== undefined) return Deferred.await(queued);
          const outcome = Deferred.makeUnsafe<MirrorSync, GithubMirrorUnavailable | SqlError>();
          waiting.set(key, outcome);
          const started = Effect.sync(() => {
            if (waiting.get(key) === outcome) waiting.delete(key);
          });
          return serialized(key, Effect.andThen(started, effect)).pipe(
            Effect.onExit((exit) => Effect.andThen(started, Deferred.done(outcome, exit))),
            Effect.forkIn(layerScope),
            Effect.andThen(Deferred.await(outcome)),
          );
        });

      /** The connected GitHub repository: `owner/name`, and its id there as it was connected. */
      const connectedOf = (appId: string, repo: string) =>
        Effect.map(
          sql<{ readonly url: string; readonly host_repo_id: string | null }>`
            SELECT url, host_repo_id FROM hq_repo_remote
            WHERE app_id::text = ${appId} AND repo = ${repo} AND via = 'app'`,
          (rows) => {
            const remote = rows[0] === undefined ? undefined : remoteIdentity(rows[0].url);
            return remote?.kind === "github"
              ? { repository: remote.path, id: rows[0]?.host_repo_id ?? null }
              : undefined;
          },
        );
      const repositoryOf = (appId: string, repo: string) =>
        Effect.map(connectedOf(appId, repo), (connected) => connected?.repository);

      /**
       * GitHub's repository for `repo`, and the app's token for it; not mirrored without both. Only
       * the repository connected, by its id: one deleted and made again under its name is refused
       * and never pushed to.
       */
      const remoteFor = (appId: string, repo: string) =>
        Effect.gen(function* () {
          const connected = yield* connectedOf(appId, repo);
          if (connected === undefined) return yield* unavailable("not_mirrored");
          const notConnected = unavailable(
            "refused",
            "the repository on GitHub is not the one connected",
          );
          if (connected.id === null) return yield* notConnected;
          const token = yield* auth
            .tokenFor(connected.repository, "git", connected.id)
            .pipe(
              Effect.mapError((error) =>
                error.reason === "replaced"
                  ? notConnected
                  : unavailable(
                      error.reason === "unreachable" ? "unreachable" : "refused",
                      error.reason,
                    ),
              ),
            );
          if (token === undefined) return yield* unavailable("not_mirrored");
          return { url: gitUrl(connected.repository), token } satisfies MirrorRemote;
        });

      /** The repository's row says how it last followed GitHub (`outcome`, on `branch`). */
      const recordFollow = (at: Repo, branch: string, outcome: MirrorSync) => {
        // Where both stand now: GitHub took Mate's main, or Mate's main took GitHub's.
        const synced =
          outcome.kind === "imported"
            ? outcome.to
            : outcome.kind === "diverged" || outcome.sha === ""
              ? null
              : outcome.sha;
        const diverged = outcome.kind === "diverged";
        return sql`
          INSERT INTO hq_repo_mirror (app_id, repo, branch, synced_sha, synced_at, diverged_since)
          VALUES (${at.appId}::uuid, ${at.id}, ${branch}, ${synced},
            CASE WHEN ${synced}::text IS NULL THEN NULL ELSE now() END,
            CASE WHEN ${diverged}::boolean THEN now() END)
          ON CONFLICT (app_id, repo) DO UPDATE SET branch = excluded.branch,
            synced_sha = COALESCE(excluded.synced_sha, hq_repo_mirror.synced_sha),
            synced_at = COALESCE(excluded.synced_at, hq_repo_mirror.synced_at),
            diverged_since = CASE WHEN excluded.diverged_since IS NULL THEN NULL
              ELSE COALESCE(hq_repo_mirror.diverged_since, excluded.diverged_since) END`;
      };

      /**
       * One try at following GitHub. What it reads and pushes there runs holding nothing; only
       * moving `main` takes the repository's lock, and its CAS from the `main` read before. A side
       * that moved meanwhile is `moved`: tried again.
       */
      const follow = (git: HqGit, at: Repo, remote: MirrorRemote) =>
        Effect.gen(function* () {
          const head = yield* git.remoteHead(at, remote);
          const main = yield* mainOf(git, at);
          const branch = head.branch;
          // Fetched only when it is news: a tip HQ's main already is needs nothing brought in.
          const tip =
            head.sha === null || head.sha === main
              ? head.sha
              : yield* git.fetchTip(at, remote, branch);
          const recorded = (outcome: MirrorSync) =>
            Effect.as(leader.write(recordFollow(at, branch, outcome)), outcome);
          if (tip === main) return yield* recorded({ kind: "same", sha: main ?? "" });
          const behind = tip === null || (main !== null && (yield* git.isAncestor(at, tip, main)));
          // A repository HQ made and nobody wrote to (its empty root commit) takes GitHub's
          // history in its place: connecting it to a repository with code loses nothing.
          const unwritten =
            !behind && main !== null && tip !== null && (yield* git.holdsNothing(at, main));
          if (main !== null && behind) {
            const pushed = yield* git.pushRef(at, remote, branch, main, tip);
            if (pushed.kind === "rejected") return "moved" as const;
            return yield* recorded({ kind: "pushed", sha: main });
          }
          if (
            tip !== null &&
            (main === null || unwritten || (yield* git.isAncestor(at, main, tip)))
          ) {
            const outcome = { kind: "imported", from: main ?? "", to: tip } as const;
            return yield* holdingRepo(
              at,
              Effect.gen(function* () {
                const moved = yield* git.fastForwardMain(at, tip, main);
                if (moved.kind !== "moved") return "moved" as const;
                yield* recordFollow(at, branch, outcome);
                return outcome;
              }),
            );
          }
          return yield* recorded({ kind: "diverged", mate: main ?? "", github: tip ?? "" });
        });

      /**
       * After an import from `from` to `to`: each open change whose head `to` brought onto `main` —
       * a merge on GitHub that kept its commits — merged as the merge commit that took its head,
       * landing the head that merge took (which may be a later push HQ has not heard of); or, where
       * `main` moved onto it with no merge commit, as the head its pull request says GitHub merged.
       * One import can bring several.
       */
      const landContained = (git: HqGit, at: Repo, from: string, to: string) =>
        Effect.gen(function* () {
          const open = yield* sql<{
            readonly number: number;
            readonly head: string;
            readonly pulled: string | null;
          }>`
            SELECT c.number, c.head, COALESCE(pr.merged_head, pr.head_sha) AS pulled
            FROM hq_change c
            LEFT JOIN hq_pull_request pr
              ON pr.app_id = c.app_id AND pr.repo = c.repo AND pr.number = c.number
            WHERE c.app_id::text = ${at.appId} AND c.repo = ${at.id} AND c.state = 'open'
              AND c.head IS NOT NULL`;
          if (open.length === 0) return;
          const brought = yield* git.range(at, from === "" ? null : from, to, {
            limit: COMPARE_COMMITS_MAX,
          });
          for (const change of open) {
            const before = from !== "" && (yield* git.isAncestor(at, change.head, from));
            if (before || !(yield* git.isAncestor(at, change.head, to))) continue;
            // Oldest first: the merge that took the head, not a later one that took it along.
            let merge: { readonly sha: string; readonly head: string } | undefined;
            for (const commit of brought.items.toReversed()) {
              for (const parent of commit.parents.slice(1))
                if (yield* git.isAncestor(at, change.head, parent)) {
                  merge = { sha: commit.sha, head: parent };
                  break;
                }
              if (merge !== undefined) break;
            }
            const pulled =
              change.pulled !== null && (yield* git.isAncestor(at, change.pulled, to))
                ? change.pulled
                : change.head;
            const mergedSha = merge?.sha ?? pulled;
            const mergedHead = merge?.head ?? pulled;
            yield* changes.landImported(at.appId, at.id, change.number, mergedSha, mergedHead).pipe(
              Effect.catch((error) =>
                Effect.logWarning("an imported merge's change not recorded merged", {
                  appId: at.appId,
                  repo: at.id,
                  number: change.number,
                  error,
                }),
              ),
            );
          }
        });

      /**
       * Whether GitHub lets only what Mate approved reach the default branch HQ follows, as its
       * rules and the app's grant read now (`governanceOf`), kept on the repository's row; an
       * answer that says nothing keeps the last.
       */
      const govern = (appId: string, repo: string) =>
        Effect.gen(function* () {
          const connected = yield* connectedOf(appId, repo);
          const [followed] = yield* sql<{ readonly branch: string }>`
            SELECT branch FROM hq_repo_mirror WHERE app_id::text = ${appId} AND repo = ${repo}`;
          const remote =
            connected === undefined
              ? undefined
              : remoteIdentity(`https://github.com/${connected.repository}`);
          if (connected?.id == null || remote === undefined || followed === undefined) return;
          const grant = yield* auth.grantOf(connected.repository, connected.id);
          const token = yield* auth.tokenFor(connected.repository, "reach", connected.id);
          if (grant === undefined || token === undefined) return;
          const rules = yield* transport.rules(remote, followed.branch, token);
          const governance = governanceOf(rules, grant.appId, grant.permissions);
          if (governance === undefined) return;
          const changed = yield* leader.write(sql`
            UPDATE hq_repo_mirror SET governance = ${governance}
            WHERE app_id::text = ${appId} AND repo = ${repo}
              AND governance IS DISTINCT FROM ${governance}
            RETURNING 1`);
          if (changed.length > 0) yield* SubscriptionRef.update(governed, (n) => n + 1);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a mirrored repository's rules not read", { appId, repo, cause }),
          ),
        );

      /** The repositories whose last follow of GitHub's other refs failed: said once, until one works. */
      const othersFailing = new Set<string>();
      /**
       * GitHub's other branches and tags, as they are there now: what it deleted is named. Never
       * decides the sync: one object git refuses anywhere there fails the whole fetch, every time, and
       * main, its rules and its merges follow regardless; the next sync tries again.
       */
      const followOthers = (git: HqGit, at: Repo, remote: MirrorRemote) => {
        const key = `${at.appId}/${at.id}`;
        const context = { appId: at.appId, repo: at.id };
        return Effect.gen(function* () {
          const refs = yield* git.followRefs(at, remote);
          for (const ref of refs.pruned)
            yield* Effect.logInfo("a ref deleted on GitHub left HQ's copy", { ...context, ref });
          if (othersFailing.delete(key))
            yield* Effect.logInfo("GitHub's other branches and tags followed again", context);
        }).pipe(
          Effect.catch((error) =>
            othersFailing.has(key)
              ? Effect.void
              : Effect.andThen(
                  Effect.sync(() => othersFailing.add(key)),
                  Effect.logWarning("GitHub's other branches and tags not followed", {
                    ...context,
                    error,
                  }),
                ),
          ),
        );
      };

      const sync: GithubMirror["Service"]["sync"] = (appId, repo) =>
        coalesced(
          `${appId}/${repo}`,
          Effect.gen(function* () {
            const remote = yield* remoteFor(appId, repo);
            const git = yield* gitHost.git.pipe(Effect.mapError(fromGit));
            const at = { appId, id: repo };
            const once = follow(git, at, remote).pipe(
              Effect.catchTags({
                GitError: (e) => Effect.fail(fromGit(e)),
                NotLeader: (e) => Effect.fail(fromGit(e)),
              }),
              Effect.provide(services),
            );
            // A side that moved while it was read is read again, once.
            const first = yield* once;
            const outcome = first === "moved" ? yield* once : first;
            if (outcome === "moved")
              return yield* unavailable("busy", "GitHub or Mate's main kept moving");
            if (outcome.kind === "imported")
              yield* landContained(git, at, outcome.from, outcome.to).pipe(
                Effect.catchTags({ GitError: (e) => Effect.fail(fromGit(e)) }),
              );
            if (outcome.kind === "diverged")
              yield* Effect.logWarning("a mirrored repository and GitHub diverged", {
                appId,
                repo,
                mate: outcome.mate,
                github: outcome.github,
              });
            yield* followOthers(git, at, remote);
            yield* govern(appId, repo);
            return outcome;
          }),
        );

      const keepPushed = (
        appId: string,
        repo: string,
        number: number,
        branch: string,
        sha: string,
      ) =>
        leader
          .write(
            sql`
              INSERT INTO hq_change_mirror (app_id, repo, number, branch, pushed_sha)
              VALUES (${appId}::uuid, ${repo}, ${number}, ${branch}, ${sha})
              ON CONFLICT (app_id, repo, number) DO UPDATE
              SET pushed_sha = excluded.pushed_sha, pushed_at = now(),
                diverged_head = NULL, diverged_since = NULL`,
          )
          .pipe(
            Effect.asVoid,
            Effect.mapError((error) => (error._tag === "NotLeader" ? fromGit(error) : error)),
          );

      /**
       * Tells the change's task's Mate, once per commit, that people added `sha` on GitHub: its own
       * copy of the branch is behind HQ's now.
       */
      const tellAdded = (git: HqGit, at: Repo, number: number, sha: string) =>
        Effect.gen(function* () {
          const [task] = yield* sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_task
            WHERE app_id::text = ${at.appId} AND change_repo = ${at.id}
              AND change_number = ${number}
            ORDER BY created_at DESC LIMIT 1`;
          if (task === undefined) return;
          const commit = yield* git.commit(at, sha).pipe(Effect.mapError(fromGit));
          const who = githubLogin(commit.author.email) ?? commit.author.name;
          const subject = commit.message.split("\n")[0] ?? "";
          yield* tasks
            .message(task.id, {
              id: `github-commits:${sha}`,
              from: "review",
              author: who,
              text: `${who} added commits to your change on GitHub (${sha.slice(0, 7)} ${subject}). Pull Mate's copy of your branch before your next push.`,
            })
            .pipe(
              Effect.mapError((error) => (error._tag === "NotLeader" ? fromGit(error) : error)),
            );
        });

      /**
       * The change's head to its branch on GitHub; where GitHub's branch moved since HQ pushed it
       * (`githubMoved`, or a lease refused): commits people added there on top of the head come into
       * HQ's copy, a branch put back behind the head is pushed on, and histories neither contains
       * are kept as diverged — not tried again until either side moves.
       */
      const mirrorChange = (appId: string, repo: string, number: number, githubMoved?: string) =>
        serialized(
          `${appId}/${repo}/${String(number)}`,
          Effect.gen(function* () {
            if ((yield* repositoryOf(appId, repo)) === undefined) return undefined;
            const [change] = yield* sql<{
              readonly state: string;
              readonly head: string | null;
              readonly title: string;
              readonly mate_project_id: string;
              readonly branch: string;
            }>`
              SELECT state, head, title, mate_project_id, branch FROM hq_change
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`;
            if (change === undefined || change.state !== "open" || change.head === null)
              return undefined;
            const [kept] = yield* sql<{ readonly branch: string; readonly pushed_sha: string }>`
              SELECT branch, pushed_sha FROM hq_change_mirror
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`;
            const branch = kept?.branch ?? changeBranch(number, change.title);
            const head = change.head;
            const news = githubMoved !== undefined && githubMoved !== kept?.pushed_sha;
            if (kept?.pushed_sha === head && !news) return { branch, sha: head };
            const remote = yield* remoteFor(appId, repo);
            const git = yield* gitHost.git.pipe(Effect.mapError(fromGit));
            const at = { appId, id: repo };
            const pushed = news
              ? ({ kind: "rejected", reason: "stale" } as const)
              : yield* git
                  .pushRef(at, remote, branch, head, kept?.pushed_sha ?? null)
                  .pipe(Effect.mapError(fromGit));
            if (pushed.kind === "pushed") {
              yield* keepPushed(appId, repo, number, branch, head);
              return { branch, sha: head };
            }
            if (pushed.reason === "refused")
              return yield* unavailable("refused", `GitHub refused ${branch}`);
            // GitHub's branch is not what HQ pushed last: read what it is.
            const theirs = yield* git.fetchTip(at, remote, branch).pipe(Effect.mapError(fromGit));
            const ancestor = (a: string, b: string) =>
              git.isAncestor(at, a, b).pipe(Effect.mapError(fromGit));
            if (theirs === head) {
              yield* keepPushed(appId, repo, number, branch, head);
              return { branch, sha: head };
            }
            if (theirs !== null && (yield* ancestor(head, theirs))) {
              const moved = yield* git
                .fastForwardChange(
                  at,
                  { mateId: change.mate_project_id, number, branch: change.branch },
                  theirs,
                  head,
                )
                .pipe(Effect.mapError(fromGit));
              if (moved.kind !== "moved")
                return yield* unavailable("busy", "the change's head moved meanwhile");
              yield* keepPushed(appId, repo, number, branch, theirs);
              yield* tellAdded(git, at, number, theirs);
              return { branch, sha: theirs };
            }
            if (theirs === null || (yield* ancestor(theirs, head))) {
              const again = yield* git
                .pushRef(at, remote, branch, head, theirs)
                .pipe(Effect.mapError(fromGit));
              if (again.kind === "rejected")
                return yield* unavailable("busy", `${branch} on GitHub moved meanwhile`);
              yield* keepPushed(appId, repo, number, branch, head);
              return { branch, sha: head };
            }
            yield* leader
              .write(
                sql`
                  INSERT INTO hq_change_mirror (app_id, repo, number, branch, pushed_sha,
                    diverged_head, diverged_since)
                  VALUES (${appId}::uuid, ${repo}, ${number}, ${branch}, ${theirs}, ${head}, now())
                  ON CONFLICT (app_id, repo, number) DO UPDATE
                  SET pushed_sha = excluded.pushed_sha, diverged_head = excluded.diverged_head,
                    diverged_since = COALESCE(hq_change_mirror.diverged_since, now())`,
              )
              .pipe(
                Effect.mapError((error) => (error._tag === "NotLeader" ? fromGit(error) : error)),
              );
            return yield* unavailable(
              "refused",
              `${branch} on GitHub holds commits HQ did not push`,
            );
          }),
        );
      const pushChange: GithubMirror["Service"]["pushChange"] = (appId, repo, number) =>
        mirrorChange(appId, repo, number);

      /** A background follow: what failed is logged, and tried again by the next move or sweep. */
      const quietly = <A>(
        what: string,
        context: object,
        effect: Effect.Effect<A, GithubMirrorUnavailable | SqlError>,
      ) =>
        effect.pipe(
          Effect.asVoid,
          Effect.catch((error) =>
            error._tag === "GithubMirrorUnavailable" && error.reason === "not_mirrored"
              ? Effect.void
              : Effect.logWarning(what, { ...context, error }),
          ),
        );

      const mirrored = sql<{
        readonly app_id: string;
        readonly repo: string;
        readonly url: string;
      }>`
        SELECT app_id::text AS app_id, repo, url FROM hq_repo_remote WHERE via = 'app'`;

      // Every move of HQ's git: a change's push reaches its branch, a move of main GitHub's.
      yield* Effect.forkScoped(
        gitHost.moves.pipe(
          Stream.mapEffect(
            (move) =>
              move.kind === "change"
                ? quietly(
                    "a change's push not mirrored to GitHub",
                    { repo: move.repo, number: move.number },
                    pushChange(move.repo.appId, move.repo.id, move.number),
                  )
                : move.by === "import"
                  ? Effect.void
                  : quietly(
                      "main not mirrored to GitHub",
                      { repo: move.repo },
                      sync(move.repo.appId, move.repo.id),
                    ),
            { concurrency: 4, unordered: true },
          ),
          Stream.runDrain,
        ),
      );

      // GitHub's push to a mirrored repository, to any branch or tag, made or deleted: a merge or a
      // push to the default branch moves Mate's main, and every one follows GitHub's other refs.
      yield* events.on("push", (event) =>
        Effect.gen(function* () {
          const payload = event.payload as {
            readonly ref?: unknown;
            readonly after?: unknown;
            readonly repository?: { readonly default_branch?: unknown };
          };
          const ref = payload.ref;
          if (
            event.repository === undefined ||
            typeof payload.repository?.default_branch !== "string" ||
            typeof ref !== "string" ||
            !/^refs\/(?:heads|tags)\//u.test(ref)
          )
            return;
          const named = event.repository.toLowerCase();
          const after = typeof payload.after === "string" ? payload.after : "";
          for (const row of yield* mirrored) {
            if (remoteIdentity(row.url)?.path !== named) continue;
            // A change's branch moved there, as HQ named it: someone added commits to its pull
            // request.
            const changed = ref.startsWith("refs/heads/")
              ? yield* sql<{ readonly number: number }>`
                  SELECT number FROM hq_change_mirror
                  WHERE app_id::text = ${row.app_id} AND repo = ${row.repo}
                    AND branch = ${ref.slice("refs/heads/".length)}`
              : [];
            for (const { number } of changed)
              yield* quietly(
                "GitHub's push to a change's branch not followed",
                { appId: row.app_id, repo: row.repo, number, deliveryId: event.deliveryId },
                mirrorChange(row.app_id, row.repo, number, after),
              );
            yield* quietly(
              "GitHub's push not followed",
              { appId: row.app_id, repo: row.repo, deliveryId: event.deliveryId },
              sync(row.app_id, row.repo),
            );
          }
        }).pipe(
          Effect.catch((error) => Effect.logWarning("GitHub's push not followed", { error })),
        ),
      );

      // The sweep: every mirrored repository follows GitHub, and every change not yet there goes.
      const sweep = Effect.gen(function* () {
        if ((yield* leader.status).state !== "active") return;
        for (const row of yield* mirrored) {
          const context = { appId: row.app_id, repo: row.repo };
          yield* quietly("a mirrored repository not followed", context, sync(row.app_id, row.repo));
          const behind = yield* changesToPush(sql, row.app_id, row.repo);
          for (const number of behind)
            yield* quietly(
              "a change's push not mirrored to GitHub",
              { ...context, number },
              pushChange(row.app_id, row.repo, number),
            );
        }
      }).pipe(Effect.catch((error) => Effect.logWarning("the mirror's sweep failed", { error })));
      yield* Effect.forkScoped(
        sweep.pipe(Effect.repeat(Schedule.spaced(options.sweepEvery ?? Duration.minutes(1)))),
      );

      const followLater = (appId: string, repo: string) =>
        quietly("a mirrored repository not followed", { appId, repo }, sync(appId, repo)).pipe(
          Effect.forkIn(layerScope),
          Effect.asVoid,
        );

      return GithubMirror.of({
        repositoryOf,
        sync,
        pushChange,
        follow: followLater,
        changes: SubscriptionRef.changes(governed),
      });
    }),
  );
