// @effect-diagnostics nodeBuiltinImport:off -- git's smart HTTP is served on the Node request itself.
/**
 * The git layer (`@t3tools/hq-git`) as Core holds it: the bare repositories under the volume's
 * `git` directory, opened only while this Core leads.
 *
 * Opening the layer sweeps what an earlier instance left behind — its staging, its git home, its
 * scratch — so it is opened by the leader alone: through a deploy two containers share the volume
 * for about 20 s, and a standby that swept would delete the leader's work in flight. It opens on
 * taking the lead, converges every repository and reconciles from the refs what the durable log
 * missed (`hq_git_event`); it closes when the lead goes, and on shutdown before the lead is given
 * up (`core.ts`), so no git of this instance outlives its lead.
 *
 * The takeover is the barrier before git serves: one that fails opens nothing, and the opening is
 * tried again while this Core leads. A repository that does not converge is quarantined, not the
 * whole of git: it refuses every read and write (`unavailable`, its reason named), the takeover
 * judges nothing in it, `/health` lists it, and it is tried again every `quarantineRetry` — once it
 * converges, git opens again and the takeover judges it with the rest.
 *
 * Every ref the layer writes reaches the durable log through its events: a change branch's push
 * moves the change's head, `main` moving moves the repository's. Each also judges again whether a
 * change merges: a push its own change, a move of `main` the repository's open ones.
 *
 * @module gitHost
 */
import type * as NodeHttp from "node:http";

import { completionReceipt } from "@t3tools/shared/completionReceipt";
import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import {
  type GitEvent,
  GitError,
  type GitService,
  type HqGit,
  type Principal,
  type Repo,
  gitTarget,
  makeHqGit,
} from "@t3tools/hq-git";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as SqlClient from "effect/sql/SqlClient";

import { JUDGED_PER_MAIN_MOVE, type MergeabilityKind } from "@t3tools/shared/hqChanges";

import { type GitEventKind, appendEvent } from "./gitEvents.ts";
import { Leader, NotLeader } from "./leader.ts";
import { catchUp, missing } from "./reconcile.ts";
import { Rollouts, addRollout } from "./rollouts.ts";

/** A change whose branch moved: its repository, its Mate, its number. */
export interface PushedChange {
  readonly repo: Repo;
  readonly mateId: string;
  readonly number: number;
}

/** Where git stands on this Core: open, opening (leading, its takeover not through), or closed. */
export type GitState = "open" | "opening" | "closed";

/** A repository withheld from every read and write until it converges, and why. */
export interface Quarantined {
  /** `<appId>/<repo>`. */
  readonly repo: string;
  readonly reason: string;
}

/** A Mate as git serves it, decided by Core before the layer sees the request. */
export type MatePrincipal = Extract<Principal, { readonly kind: "mate" }>;

export class GitHost extends Context.Service<
  GitHost,
  {
    /** The next attempt to open git returned, including a refused takeover. */
    readonly nextAttempt: Effect.Effect<void>;
    /**
     * The git layer, while this Core leads and has it open; a quarantined repository's every
     * operation fails `unavailable`, its reason the message.
     */
    readonly git: Effect.Effect<HqGit, NotLeader>;
    /** Where git stands, and the repositories it withholds. */
    readonly status: Effect.Effect<{
      readonly git: GitState;
      readonly quarantined: ReadonlyArray<Quarantined>;
    }>;
    /**
     * The git layer once open, waited for up to `wait`: it opens a moment after the lead, its
     * takeover converging every repository first. Not open by then is `NotLeader`.
     */
    readonly opened: (wait: Duration.Duration) => Effect.Effect<HqGit, NotLeader>;
    /**
     * Serves one git request with the layer's smart HTTP; ends with the response. `decide` is told
     * the repository and the service as the layer itself reads the request — a fetch's or a push's,
     * so a verb is never chosen on another reading of its address — and answers who serves it, or
     * fails, and the layer serves nothing; a request the layer reads as no service is the layer's
     * to refuse. The layer then serves a repository only where `mayRead` allows it, and applies its
     * own write rules to a push. A quarantined repository is refused `unavailable`.
     */
    readonly serve: <E, R>(
      request: HttpServerRequest.HttpServerRequest,
      decide: (target: {
        readonly repo: Repo;
        readonly service: GitService;
      }) => Effect.Effect<Principal, E, R>,
      mayRead: (repo: Repo) => Effect.Effect<boolean>,
    ) => Effect.Effect<void, E | NotLeader | GitError, R>;
    /** Closes the layer for good: on shutdown, before the lead is given up. */
    readonly close: Effect.Effect<void>;
    /**
     * Runs `effect` while nothing else runs through here: a backup set from its database dump to
     * its last bundle, and a removal of repositories — so a set holds every repository its dump
     * names, whatever is deleted meanwhile (H4).
     */
    readonly holdingRepos: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    /** Ticks after the log has followed a ref that moved, starting with the current tick. */
    readonly recorded: Stream.Stream<number>;
    /**
     * Each change whose branch moved, after the log followed it — and, on taking the lead, every
     * open change with a head — kept until taken, for the one reader that judges a change by its
     * content (`changes.ts`).
     */
    readonly pushes: Queue.Dequeue<PushedChange>;
  }
>()("@t3tools/hq/gitHost") {}

const CHANGE_REF = /^refs\/heads\/mate\/([^/]+)\/([1-9][0-9]*)$/u;

/** Where the layer serves the repositories: its default, `/git/<appId>/<repo>.git`. */
const GIT_PREFIX = "/git";

/** `main`'s head in `repo`, none while it is unborn. */
export const mainOf = (git: HqGit, repo: Repo) =>
  Effect.map(
    git.branches(repo),
    (branches) => branches.items.find((branch) => branch.ref === "refs/heads/main")?.sha ?? null,
  );

/** A change as judged against `main` now: what its record keeps of its mergeability. */
export interface Judged {
  readonly mergeability: MergeabilityKind;
  readonly behind: boolean;
}

const UNJUDGED: Judged = { mergeability: "unknown", behind: false };

/**
 * How the change merges into `main` now, and whether `main` has moved past its merge base. A change
 * with nothing pushed, or one git cannot judge, is `unknown`.
 */
export const judge = (git: HqGit, repo: Repo, mateId: string, number: number) =>
  Effect.gen(function* () {
    const mergeability = yield* git.mergeability(repo, mateId, number);
    if (mergeability.kind === "no_change") return UNJUDGED;
    const base = yield* git.mergeBase(repo, mateId, number);
    const main = yield* mainOf(git, repo);
    return { mergeability: mergeability.kind, behind: base !== null && base !== main };
  }).pipe(Effect.orElseSucceed(() => UNJUDGED));

export const gitHostLayer = (options: {
  /** Where the bare repositories live: `/mnt/vol/git` in the container. */
  readonly rootDir: string;
  /** The first pause before opening git again after it failed, doubling up to 30 s; 1 s. */
  readonly openBackoff?: Duration.Duration;
  /** How often a quarantined repository is tried again; 1 min. */
  readonly quarantineRetry?: Duration.Duration;
}): Layer.Layer<GitHost, never, Leader | Rollouts | SqlClient.SqlClient> =>
  Layer.effect(
    GitHost,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const rollouts = yield* Rollouts;
      const sql = yield* SqlClient.SqlClient;
      const services = yield* Effect.context<SqlClient.SqlClient | Leader>();
      const run = Effect.runPromiseWith(services);
      /** Who each request in flight is, as Core decided it, and what it may read. */
      const principals = new WeakMap<NodeHttp.IncomingMessage, Principal>();
      const readers = new WeakMap<Principal, (repo: Repo) => Effect.Effect<boolean>>();

      const state = yield* Ref.make<GitState>("closed");
      /** The quarantined repositories by `<appId>/<repo>`, and why. */
      const quarantined = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
      const keyOf = (repo: Repo) => `${repo.appId}/${repo.id}`;

      const event = (repo: Repo, kind: GitEventKind, number: number | null, data: object) =>
        appendEvent(sql, { kind, appId: repo.appId, repo: repo.id, number, data });

      /**
       * A change's branch now at `head`, judged as `judged`: its record follows — the push moves it
       * — and the log says so.
       */
      const pushed = (
        repo: Repo,
        change: { readonly mateId: string; readonly number: number },
        old: string | null,
        head: string,
        judged: Judged,
        data: object,
      ) =>
        Effect.gen(function* () {
          const moved = yield* sql`
            UPDATE hq_change
            SET head = ${head}, updated_at = now(),
                mergeability = ${judged.mergeability}, behind = ${judged.behind}
            WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND number = ${change.number}
              AND mate_project_id = ${change.mateId}
            RETURNING 1`;
          if (moved.length > 0) {
            const ref = `refs/heads/mate/${change.mateId}/${String(change.number)}`;
            yield* event(repo, "pushed", change.number, { ref, old, new: head, ...data });
          }
        });

      /** The change a ref is the branch of, if it is one. */
      const changeOfRef = (ref: string) => {
        const match = CHANGE_REF.exec(ref);
        return match === null ? undefined : { mateId: match[1] ?? "", number: Number(match[2]) };
      };

      /**
       * After `main` moved: the repository's newest {@link JUDGED_PER_MAIN_MOVE} open changes
       * judged again, the rest `unknown` until their detail is read.
       */
      const rejudge = (git: HqGit, repo: Repo) =>
        Effect.gen(function* () {
          const open = yield* sql<{ readonly number: number; readonly mate_project_id: string }>`
            SELECT number, mate_project_id FROM hq_change
            WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND state = 'open'
            ORDER BY number DESC`;
          const judged = yield* Effect.forEach(open, (row, i) =>
            i < JUDGED_PER_MAIN_MOVE
              ? Effect.map(judge(git, repo, row.mate_project_id, row.number), (verdict) => ({
                  number: row.number,
                  verdict,
                }))
              : Effect.succeed({ number: row.number, verdict: UNJUDGED }),
          );
          yield* leader.write(
            Effect.forEach(
              judged,
              ({ number, verdict }) => sql`
                UPDATE hq_change
                SET mergeability = ${verdict.mergeability}, behind = ${verdict.behind}
                WHERE app_id::text = ${repo.appId} AND repo = ${repo.id} AND number = ${number}`,
              { discard: true },
            ),
          );
        });

      /**
       * `main` now at `head`: the repository's record follows, with when, the log says so, and the
       * merge asks for its deploys (`rollouts.ts`) — a move the log missed and a takeover found too,
       * for it is a merge recorded late.
       */
      const mainMoved = (repo: Repo, old: string | null, head: string, by: string) =>
        Effect.all([
          sql`
            UPDATE hq_repo SET main_head = ${head}, updated_at = now()
            WHERE app_id::text = ${repo.appId} AND name = ${repo.id}`,
          event(repo, "main_moved", null, { old, new: head, by }),
          addRollout(sql, { cause: "merge", appId: repo.appId, repo: repo.id, sha: head }),
        ]);

      const ticks = yield* SubscriptionRef.make(0);
      const tick = SubscriptionRef.update(ticks, (n) => n + 1);
      const pushes = yield* Queue.unbounded<PushedChange>();

      /** A ref the layer wrote: the change it is the branch of judged, or the repository's main. */
      const record = (git: HqGit, event: GitEvent) =>
        Effect.gen(function* () {
          if (event.kind === "pushed") {
            for (const update of event.updates) {
              const change = changeOfRef(update.ref);
              if (change === undefined) continue;
              const verdict = yield* judge(git, event.repo, change.mateId, change.number);
              yield* leader.write(
                pushed(event.repo, change, update.oldSha, update.newSha, verdict, {}),
              );
              yield* Queue.offer(pushes, { repo: event.repo, ...change });
            }
          } else if (event.kind === "main_moved") {
            yield* leader.write(mainMoved(event.repo, event.old, event.new, event.by));
            yield* rollouts.wake;
            yield* rejudge(git, event.repo);
          }
          yield* tick;
        });

      /**
       * On taking the lead: every repository converged; records that name what git lacks hold the
       * lead, serving nothing; what git holds beyond the records recorded (`reconcile.ts`), and what
       * the refs show the log missed; answers the open changes with a head, for their content to be
       * judged again.
       */
      const takeover = (git: HqGit) =>
        Effect.gen(function* () {
          const found: Array<PushedChange> = [];
          const withheld = new Map<string, string>();
          for (const repo of yield* git.list()) {
            const converged = yield* Effect.exit(git.convergeRepo(repo));
            if (Exit.isFailure(converged)) {
              const error = Cause.findErrorOption(converged.cause);
              const reason = `converge_${Option.isSome(error) ? error.value.reason : "failed"}`;
              withheld.set(keyOf(repo), reason);
              yield* Effect.logError("repository quarantined: it did not converge", {
                repo,
                reason,
              });
            }
          }
          yield* Ref.set(quarantined, withheld);
          const aside = new Set(withheld.keys());
          const lacked = yield* missing(git, sql, aside);
          if (Object.keys(lacked).length > 0) {
            yield* Effect.logError("HQ's records name what git lacks: serving nothing", lacked);
            yield* leader.hold("restore_mismatch");
            return found;
          }
          yield* catchUp(git, sql, leader, aside);
          const repos = (yield* sql<{
            readonly app_id: string;
            readonly name: string;
            readonly main_head: string | null;
          }>`SELECT app_id::text AS app_id, name, main_head FROM hq_repo`).filter(
            (row) => !aside.has(`${row.app_id}/${row.name}`),
          );
          for (const row of repos) {
            const repo = { appId: row.app_id, id: row.name };
            const main = yield* mainOf(git, repo).pipe(Effect.option);
            if (Option.isSome(main) && main.value !== null && main.value !== row.main_head) {
              yield* leader.write(mainMoved(repo, row.main_head, main.value, "reconcile"));
              yield* rollouts.wake;
            }
          }
          const open = yield* sql<{
            readonly app_id: string;
            readonly repo: string;
            readonly number: number;
            readonly mate_project_id: string;
            readonly head: string | null;
          }>`
            SELECT app_id::text AS app_id, repo, number, mate_project_id, head
            FROM hq_change WHERE state = 'open'`;
          for (const row of open) {
            const repo = { appId: row.app_id, id: row.repo };
            if (aside.has(keyOf(repo))) continue;
            const head = yield* git
              .changeHead(repo, row.mate_project_id, row.number)
              .pipe(Effect.option);
            if (Option.isNone(head) || head.value === null) continue;
            const change = { mateId: row.mate_project_id, number: row.number };
            if (head.value !== row.head) {
              const verdict = yield* judge(git, repo, change.mateId, change.number);
              yield* leader.write(
                pushed(repo, change, row.head, head.value, verdict, { reconciled: true }),
              );
            }
            found.push({ repo, ...change });
          }
          // What was judged before this lead may be stale: main may have moved since.
          for (const row of repos) yield* rejudge(git, { appId: row.app_id, id: row.name });
          yield* tick;
          return found;
        });

      const current = yield* Ref.make<
        Option.Option<{ readonly git: HqGit; readonly scope: Scope.Closeable }>
      >(Option.none());
      const stopped = yield* Ref.make(false);
      const permit = yield* Semaphore.make(1);
      const holding = yield* Semaphore.make(1);

      const open = Semaphore.withPermits(
        permit,
        1,
      )(
        Effect.gen(function* () {
          if ((yield* Ref.get(stopped)) || Option.isSome(yield* Ref.get(current))) return;
          // Only while leading: the lead may have gone since the opening was asked for.
          if ((yield* leader.status).state !== "active") return;
          yield* Ref.set(state, "opening");
          const scope = yield* Scope.make();
          // Events come only after a write, so never before the layer is here.
          const opened: { git?: HqGit } = {};
          const git = yield* makeHqGit({
            rootDir: options.rootDir,
            authenticate: (request) => principals.get(request) ?? null,
            canRead: (principal, repo) => {
              const mayRead = readers.get(principal);
              return mayRead === undefined ? false : run(mayRead(repo));
            },
            lookupChange: (repo, _mateId, number) =>
              run(
                Effect.map(
                  sql<{ readonly mate_project_id: string; readonly state: string }>`
                    SELECT mate_project_id, state FROM hq_change
                    WHERE app_id::text = ${repo.appId} AND repo = ${repo.id}
                      AND number = ${number}`,
                  (rows) => {
                    const row = rows[0];
                    return row === undefined
                      ? null
                      : {
                          appId: repo.appId,
                          mateId: row.mate_project_id,
                          number,
                          open: row.state === "open",
                          merged: row.state === "merged",
                        };
                  },
                ),
              ),
            onEvent: (event) =>
              opened.git === undefined ? undefined : run(record(opened.git, event)),
          }).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.tapError(() => Scope.close(scope, Exit.void)),
          );
          opened.git = git;
          // The takeover is the barrier: one that fails opens nothing, and the opening is tried again.
          const open = yield* takeover(git).pipe(
            Effect.tapError(() => Scope.close(scope, Exit.void)),
          );
          yield* Ref.set(current, Option.some({ git, scope }));
          yield* Ref.set(state, "open");
          yield* Effect.logInfo("git open");
          // Judged once the layer serves: what the last lead left open is judged again.
          yield* Queue.offerAll(pushes, open);
        }),
      );

      const shut = Semaphore.withPermits(
        permit,
        1,
      )(
        Effect.gen(function* () {
          const open = yield* Ref.getAndSet(current, Option.none());
          yield* Ref.set(state, "closed");
          // What the next takeover quarantines is its own to say.
          yield* Ref.set(quarantined, new Map());
          if (Option.isSome(open)) {
            yield* Scope.close(open.value.scope, Exit.void);
            yield* Effect.logInfo("git closed");
          }
        }),
      );

      // A failed opening is tried again while this Core leads, its pauses growing to 30 s; a change
      // of the lead cuts the pauses short, never an opening or a closing half done.
      const backoff = Schedule.min([
        Schedule.exponential(options.openBackoff ?? Duration.seconds(1)),
        Schedule.spaced(Duration.seconds(30)),
      ]);
      const attempts = completionReceipt();
      const openWhileLeading = Effect.uninterruptible(
        open.pipe(
          Effect.ensuring(attempts.complete),
          Effect.tapError((error) => Effect.logError("git open failed", error)),
        ),
      ).pipe(Effect.retry(backoff), Effect.ignore);
      yield* Effect.forkScoped(
        leader.changes.pipe(
          Stream.switchMap((status) =>
            Stream.fromEffect(
              status.state === "active" ? openWhileLeading : Effect.uninterruptible(shut),
            ),
          ),
          Stream.runDrain,
        ),
      );
      yield* Effect.addFinalizer(() => shut);

      // A quarantined repository is tried again; once it converges, git opens again, so the
      // takeover judges it with the rest before it serves.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const opened = yield* Ref.get(current);
          const withheld = yield* Ref.get(quarantined);
          if (Option.isNone(opened) || withheld.size === 0) return;
          for (const key of withheld.keys()) {
            const [appId = "", id = ""] = key.split("/");
            if (Exit.isSuccess(yield* Effect.exit(opened.value.git.convergeRepo({ appId, id })))) {
              yield* Effect.logInfo("quarantined repository converged: git opens again", { key });
              yield* Effect.uninterruptible(shut);
              yield* Effect.uninterruptible(open).pipe(
                Effect.tapError((error) => Effect.logError("git open failed", error)),
                Effect.retry(backoff),
              );
              return;
            }
          }
        }).pipe(
          Effect.catch((error) => Effect.logError("git open failed", error)),
          Effect.repeat(Schedule.spaced(options.quarantineRetry ?? Duration.minutes(1))),
        ),
      );

      /** `git` refusing every operation on a quarantined repository. */
      const guarded = (git: HqGit): HqGit =>
        new Proxy(git, {
          get: (target, property, receiver) => {
            const value: unknown = Reflect.get(target, property, receiver);
            if (typeof value !== "function" || property === "handler") return value;
            const call = value as (...all: Array<unknown>) => Effect.Effect<unknown>;
            return (...args: Array<unknown>) => {
              const [repo] = args;
              if (typeof repo !== "object" || repo === null || !("appId" in repo && "id" in repo)) {
                return call.apply(target, args);
              }
              return Effect.flatMap(Ref.get(quarantined), (withheld) => {
                const reason = withheld.get(keyOf(repo as Repo));
                return reason === undefined
                  ? call.apply(target, args)
                  : Effect.fail(
                      new GitError({
                        operation: String(property),
                        reason: "unavailable",
                        message: reason,
                      }),
                    );
              });
            };
          },
        });

      const git = Effect.flatMap(Ref.get(current), (open) =>
        Option.isSome(open)
          ? Effect.succeed(guarded(open.value.git))
          : Effect.fail(new NotLeader({ reason: "standby" })),
      );
      return GitHost.of({
        nextAttempt: Effect.suspend(attempts.next),
        git,
        status: Effect.gen(function* () {
          const withheld = yield* Ref.get(quarantined);
          return {
            git: yield* Ref.get(state),
            quarantined: [...withheld].map(([repo, reason]) => ({ repo, reason })),
          };
        }),
        opened: (wait) =>
          git.pipe(
            Effect.retry(Schedule.spaced(Duration.millis(50))),
            Effect.timeoutOrElse({
              duration: wait,
              orElse: () => Effect.fail(new NotLeader({ reason: "standby" })),
            }),
          ),
        serve: (request, decide, mayRead) =>
          Effect.gen(function* () {
            const layer = yield* git;
            const req = NodeHttpServerRequest.toIncomingMessage(request);
            const res = NodeHttpServerRequest.toServerResponse(request);
            const target = gitTarget(GIT_PREFIX, req.url ?? "");
            if (target !== null && target.service !== null) {
              const principal = yield* decide({ repo: target.repo, service: target.service });
              const reason = (yield* Ref.get(quarantined)).get(keyOf(target.repo));
              if (reason !== undefined) {
                return yield* new GitError({
                  operation: "serve",
                  reason: "unavailable",
                  message: reason,
                });
              }
              principals.set(req, principal);
              readers.set(principal, mayRead);
            }
            yield* Effect.callback<void>((resume) => {
              res.once("close", () => resume(Effect.void));
              layer.handler(req, res);
            });
          }),
        close: Effect.andThen(Ref.set(stopped, true), shut),
        holdingRepos: (effect) => Semaphore.withPermits(holding, 1)(effect),
        recorded: SubscriptionRef.changes(ticks),
        pushes,
      });
    }),
  );
