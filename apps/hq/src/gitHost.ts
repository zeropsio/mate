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
 * Every ref the layer writes reaches the durable log through its events: a change branch's push
 * moves the change's head, `main` moving moves the repository's. Each also judges again whether a
 * change merges: a push its own change, a move of `main` the repository's open ones.
 *
 * @module gitHost
 */
import type * as NodeHttp from "node:http";

import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import {
  type GitEvent,
  type GitService,
  type HqGit,
  type Principal,
  type Repo,
  gitTarget,
  makeHqGit,
} from "@t3tools/hq-git";
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
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { JUDGED_PER_MAIN_MOVE, type MergeabilityKind } from "@t3tools/shared/hqChanges";

import { type GitEventKind, appendEvent } from "./gitEvents.ts";
import { Leader, NotLeader } from "./leader.ts";

/** A change whose branch moved: its repository, its Mate, its number. */
export interface PushedChange {
  readonly repo: Repo;
  readonly mateId: string;
  readonly number: number;
}

/** A Mate as git serves it, decided by Core before the layer sees the request. */
export type MatePrincipal = Extract<Principal, { readonly kind: "mate" }>;

export class GitHost extends Context.Service<
  GitHost,
  {
    /** The git layer, while this Core leads and has it open. */
    readonly git: Effect.Effect<HqGit, NotLeader>;
    /**
     * Serves one git request with the layer's smart HTTP; ends with the response. `decide` is told
     * the repository and the service as the layer itself reads the request — a fetch's or a push's,
     * so a verb is never chosen on another reading of its address — and answers who serves it, or
     * fails, and the layer serves nothing; a request the layer reads as no service is the layer's
     * to refuse. The layer then serves a repository only where `mayRead` allows it, and applies its
     * own write rules to a push.
     */
    readonly serve: <E, R>(
      request: HttpServerRequest.HttpServerRequest,
      decide: (target: {
        readonly repo: Repo;
        readonly service: GitService;
      }) => Effect.Effect<MatePrincipal, E, R>,
      mayRead: (repo: Repo) => Effect.Effect<boolean>,
    ) => Effect.Effect<void, E | NotLeader, R>;
    /** Closes the layer for good: on shutdown, before the lead is given up. */
    readonly close: Effect.Effect<void>;
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
}): Layer.Layer<GitHost, never, Leader | SqlClient.SqlClient> =>
  Layer.effect(
    GitHost,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const sql = yield* SqlClient.SqlClient;
      const services = yield* Effect.context<SqlClient.SqlClient | Leader>();
      const run = Effect.runPromiseWith(services);
      /** Who each request in flight is, as Core decided it, and what it may read. */
      const principals = new WeakMap<NodeHttp.IncomingMessage, Principal>();
      const readers = new WeakMap<Principal, (repo: Repo) => Effect.Effect<boolean>>();

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

      /** `main` now at `head`: the repository's record follows, with when, and the log says so. */
      const mainMoved = (repo: Repo, old: string | null, head: string, by: string) =>
        Effect.andThen(
          sql`
            UPDATE hq_repo SET main_head = ${head}, updated_at = now()
            WHERE app_id::text = ${repo.appId} AND name = ${repo.id}`,
          event(repo, "main_moved", null, { old, new: head, by }),
        );

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
            yield* rejudge(git, event.repo);
          }
          yield* tick;
        });

      /**
       * On taking the lead: every repository converged, and what the refs show the log missed;
       * answers the open changes with a head, for their content to be judged again.
       */
      const takeover = (git: HqGit) =>
        Effect.gen(function* () {
          const found: Array<PushedChange> = [];
          for (const repo of yield* git.list()) {
            yield* git
              .convergeRepo(repo)
              .pipe(Effect.catch((error) => Effect.logWarning("git converge failed", error)));
          }
          const repos = yield* sql<{
            readonly app_id: string;
            readonly name: string;
            readonly main_head: string | null;
          }>`SELECT app_id::text AS app_id, name, main_head FROM hq_repo`;
          for (const row of repos) {
            const repo = { appId: row.app_id, id: row.name };
            const main = yield* mainOf(git, repo).pipe(Effect.option);
            if (Option.isSome(main) && main.value !== null && main.value !== row.main_head) {
              yield* leader.write(mainMoved(repo, row.main_head, main.value, "reconcile"));
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

      const open = Semaphore.withPermits(
        permit,
        1,
      )(
        Effect.gen(function* () {
          if ((yield* Ref.get(stopped)) || Option.isSome(yield* Ref.get(current))) return;
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
          const open = yield* takeover(git).pipe(
            Effect.catch((error) =>
              Effect.as(Effect.logWarning("git takeover reconcile failed", error), []),
            ),
          );
          yield* Ref.set(current, Option.some({ git, scope }));
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
      const openWhileLeading = Effect.uninterruptible(
        open.pipe(Effect.tapError((error) => Effect.logError("git open failed", error))),
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

      const git = Effect.flatMap(Ref.get(current), (open) =>
        Option.isSome(open)
          ? Effect.succeed(open.value.git)
          : Effect.fail(new NotLeader({ reason: "standby" })),
      );
      return GitHost.of({
        git,
        serve: (request, decide, mayRead) =>
          Effect.gen(function* () {
            const layer = yield* git;
            const req = NodeHttpServerRequest.toIncomingMessage(request);
            const res = NodeHttpServerRequest.toServerResponse(request);
            const target = gitTarget(GIT_PREFIX, req.url ?? "");
            if (target !== null && target.service !== null) {
              const principal = yield* decide({ repo: target.repo, service: target.service });
              principals.set(req, principal);
              readers.set(principal, mayRead);
            }
            yield* Effect.callback<void>((resume) => {
              res.once("close", () => resume(Effect.void));
              layer.handler(req, res);
            });
          }),
        close: Effect.andThen(Ref.set(stopped, true), shut),
        recorded: SubscriptionRef.changes(ticks),
        pushes,
      });
    }),
  );
