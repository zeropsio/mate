/**
 * A repository HQ mirrors to GitHub through the organization's app: GitHub's default branch is
 * upstream. HQ pushes its `main` to an empty repository, fast-forwards its own `main` to GitHub's
 * after a merge there, and pushes each open change's head to a branch of its own on GitHub, from
 * which `pullRequests.ts` keeps the change's pull request.
 *
 * @module githubMirror
 */
import type { GitError, HqGit, MirrorRemote, Repo } from "@t3tools/hq-git";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { Changes } from "./changes.ts";
import { GithubAuth } from "./githubAuth.ts";
import { GithubEvents } from "./githubEvents.ts";
import { GitHost, holdingRepo, mainOf } from "./gitHost.ts";
import { remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";

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
    /** Follow GitHub's default branch (see {@link MirrorSync}). */
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
 * git (`GitHost.moves`), on GitHub's pushes to the default branch (`GithubEvents`), and every
 * `sweepEvery`; a failure is logged and tried again on the next of these, never failing the push
 * or merge that asked for it.
 */
export const githubMirrorLayer = (
  options: GithubMirrorOptions = {},
): Layer.Layer<
  GithubMirror,
  never,
  GitHost | GithubAuth | GithubEvents | Changes | Leader | SqlClient.SqlClient
> =>
  Layer.effect(
    GithubMirror,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const gitHost = yield* GitHost;
      const auth = yield* GithubAuth;
      const events = yield* GithubEvents;
      const changes = yield* Changes;
      const gitUrl = options.gitUrl ?? ((repository) => `https://github.com/${repository}.git`);
      const services = yield* Effect.context<Leader | SqlClient.SqlClient>();

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

      const repositoryOf = (appId: string, repo: string) =>
        Effect.map(
          sql<{ readonly url: string }>`
            SELECT url FROM hq_repo_remote
            WHERE app_id::text = ${appId} AND repo = ${repo} AND via = 'app'`,
          (rows) => {
            const remote = rows[0] === undefined ? undefined : remoteIdentity(rows[0].url);
            return remote?.kind === "github" ? remote.path : undefined;
          },
        );

      /** GitHub's repository for `repo`, and the app's token for it; not mirrored without both. */
      const remoteFor = (appId: string, repo: string) =>
        Effect.gen(function* () {
          const repository = yield* repositoryOf(appId, repo);
          if (repository === undefined) return yield* unavailable("not_mirrored");
          const token = yield* auth
            .tokenFor(repository)
            .pipe(
              Effect.mapError((error) =>
                unavailable(
                  error.reason === "unreachable" ? "unreachable" : "refused",
                  error.reason,
                ),
              ),
            );
          if (token === undefined) return yield* unavailable("not_mirrored");
          return { url: gitUrl(repository), token } satisfies MirrorRemote;
        });

      /** What following GitHub found, under the repository's lock; its row says so. */
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
          const outcome: MirrorSync = yield* Effect.gen(function* () {
            if (tip === main) return { kind: "same", sha: main ?? "" } as const;
            if (main !== null && (tip === null || (yield* git.isAncestor(at, tip, main)))) {
              const pushed = yield* git.pushRef(at, remote, branch, main, tip);
              if (pushed.kind === "rejected")
                return yield* unavailable("busy", `GitHub's ${branch} moved meanwhile`);
              return { kind: "pushed", sha: main } as const;
            }
            if (tip !== null && (main === null || (yield* git.isAncestor(at, main, tip)))) {
              const moved = yield* git.fastForwardMain(at, tip, main);
              if (moved.kind !== "moved") return yield* unavailable("busy", "main moved meanwhile");
              return { kind: "imported", from: main ?? "", to: tip } as const;
            }
            return { kind: "diverged", mate: main ?? "", github: tip ?? "" } as const;
          });
          // Where both stand now: GitHub took Mate's main, or Mate's main took GitHub's.
          const synced =
            outcome.kind === "imported"
              ? outcome.to
              : outcome.kind === "diverged" || outcome.sha === ""
                ? null
                : outcome.sha;
          const diverged = outcome.kind === "diverged";
          yield* sql`
            INSERT INTO hq_repo_mirror (app_id, repo, branch, synced_sha, synced_at, diverged_since)
            VALUES (${at.appId}::uuid, ${at.id}, ${branch}, ${synced},
              CASE WHEN ${synced}::text IS NULL THEN NULL ELSE now() END,
              CASE WHEN ${diverged}::boolean THEN now() END)
            ON CONFLICT (app_id, repo) DO UPDATE SET branch = excluded.branch,
              synced_sha = COALESCE(excluded.synced_sha, hq_repo_mirror.synced_sha),
              synced_at = COALESCE(excluded.synced_at, hq_repo_mirror.synced_at),
              diverged_since = CASE WHEN excluded.diverged_since IS NULL THEN NULL
                ELSE COALESCE(hq_repo_mirror.diverged_since, excluded.diverged_since) END`;
          return outcome;
        });

      /**
       * After an import from `from` to `to`: each open change whose head `to` brought onto `main` —
       * a merge on GitHub that kept its commits — merged as `to`.
       */
      const landContained = (git: HqGit, at: Repo, from: string, to: string) =>
        Effect.gen(function* () {
          const open = yield* sql<{ readonly number: number; readonly head: string }>`
            SELECT number, head FROM hq_change
            WHERE app_id::text = ${at.appId} AND repo = ${at.id} AND state = 'open'
              AND head IS NOT NULL`;
          for (const change of open) {
            const before = from !== "" && (yield* git.isAncestor(at, change.head, from));
            if (before || !(yield* git.isAncestor(at, change.head, to))) continue;
            yield* changes.landImported(at.appId, at.id, change.number, to).pipe(
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

      const sync: GithubMirror["Service"]["sync"] = (appId, repo) =>
        serialized(
          `${appId}/${repo}`,
          Effect.gen(function* () {
            const remote = yield* remoteFor(appId, repo);
            const git = yield* gitHost.git.pipe(Effect.mapError(fromGit));
            const at = { appId, id: repo };
            const outcome = yield* holdingRepo(at, follow(git, at, remote)).pipe(
              Effect.catchTags({
                GitError: (e) => Effect.fail(fromGit(e)),
                NotLeader: (e) => Effect.fail(fromGit(e)),
              }),
              Effect.provide(services),
            );
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
            return outcome;
          }),
        );

      const pushChange: GithubMirror["Service"]["pushChange"] = (appId, repo, number) =>
        serialized(
          `${appId}/${repo}/${String(number)}`,
          Effect.gen(function* () {
            if ((yield* repositoryOf(appId, repo)) === undefined) return undefined;
            const [change] = yield* sql<{
              readonly state: string;
              readonly head: string | null;
              readonly title: string;
            }>`
              SELECT state, head, title FROM hq_change
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`;
            if (change === undefined || change.state !== "open" || change.head === null)
              return undefined;
            const [kept] = yield* sql<{ readonly branch: string; readonly pushed_sha: string }>`
              SELECT branch, pushed_sha FROM hq_change_mirror
              WHERE app_id::text = ${appId} AND repo = ${repo} AND number = ${number}`;
            const branch = kept?.branch ?? changeBranch(number, change.title);
            const head = change.head;
            if (kept?.pushed_sha === head) return { branch, sha: head };
            const remote = yield* remoteFor(appId, repo);
            const git = yield* gitHost.git.pipe(Effect.mapError(fromGit));
            const pushed = yield* git
              .pushRef({ appId, id: repo }, remote, branch, head, kept?.pushed_sha ?? null)
              .pipe(Effect.mapError(fromGit));
            if (pushed.kind === "rejected")
              return yield* unavailable(
                "refused",
                pushed.reason === "refused"
                  ? `GitHub refused ${branch}`
                  : `${branch} on GitHub holds commits HQ did not push`,
              );
            yield* leader
              .write(
                sql`
                  INSERT INTO hq_change_mirror (app_id, repo, number, branch, pushed_sha)
                  VALUES (${appId}::uuid, ${repo}, ${number}, ${branch}, ${head})
                  ON CONFLICT (app_id, repo, number) DO UPDATE
                  SET pushed_sha = excluded.pushed_sha, pushed_at = now()`,
              )
              .pipe(
                Effect.mapError((error) => (error._tag === "NotLeader" ? fromGit(error) : error)),
              );
            return { branch, sha: head };
          }),
        );

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

      // GitHub's push to a mirrored repository's default branch: a merge or a push there.
      yield* events.on("push", (event) =>
        Effect.gen(function* () {
          const payload = event.payload as {
            readonly ref?: unknown;
            readonly repository?: { readonly default_branch?: unknown };
          };
          const defaultBranch = payload.repository?.default_branch;
          if (event.repository === undefined || typeof defaultBranch !== "string") return;
          if (payload.ref !== `refs/heads/${defaultBranch}`) return;
          const named = event.repository.toLowerCase();
          for (const row of yield* mirrored) {
            if (remoteIdentity(row.url)?.path !== named) continue;
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
          const behind = yield* sql<{ readonly number: number }>`
            SELECT c.number FROM hq_change c
            LEFT JOIN hq_change_mirror m
              ON m.app_id = c.app_id AND m.repo = c.repo AND m.number = c.number
            WHERE c.app_id::text = ${row.app_id} AND c.repo = ${row.repo} AND c.state = 'open'
              AND c.head IS NOT NULL AND c.head IS DISTINCT FROM m.pushed_sha`;
          for (const { number } of behind)
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

      const layerScope = yield* Effect.scope;
      const followLater = (appId: string, repo: string) =>
        quietly("a mirrored repository not followed", { appId, repo }, sync(appId, repo)).pipe(
          Effect.forkIn(layerScope),
          Effect.asVoid,
        );

      return GithubMirror.of({ repositoryOf, sync, pushChange, follow: followLater });
    }),
  );
