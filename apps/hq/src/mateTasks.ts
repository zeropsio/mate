/**
 * Tasks from outside, handed to an application's automated Mates (`hq_task`, `@t3tools/contracts`
 * `MateTask`): the leading Core's dispatcher.
 *
 * - A Mate is free while it is automated, of the application's projects, online, on no task, no
 *   change of its last task waits for review (its copy of the code holds that work), and its agents
 *   work on nothing (its attention says `working: 0`). The oldest waiting task of an
 *   application goes to a free Mate of it (`assigned`), told over the Mate's link (`task`), and told
 *   again on each link it opens until it takes it. HQ looks again when a task waits, a Mate's link
 *   or attention moves, and a task ends.
 * - Nothing is handed out while the organization keeps no key for the provider automated Mates run
 *   on (`orgAiKeys.ts`): tasks wait, counted as waiting.
 * - A Mate that does not take its task within `acceptWithin` (60 s), its link down or not, gives it
 *   back (`queued`, one try more); the third try that runs out fails it, saying why. Its word, late
 *   on its next link, is still taken while the task waits for no other Mate.
 * - A Mate that turns its task down gives it back with no try against it; once its Mates have
 *   turned it down for 30 minutes it fails, with the last reason.
 * - The Mate's word moves its task (`task-state`): taken (`working`, in the conversation it names),
 *   then done or failed — its Mate free again. A word of a task not its own — never handed to it,
 *   or handed to another since — is passed by.
 * - A task whose Mate's record went is given back, or failed where the Mate had taken it; one whose
 *   Mate has been offline for 2 hours while on it fails, saying so.
 * - GitHub hears from the Mate by name, on the issue, with the repository's token: once it takes
 *   the issue up, once it opens its change for review (with the change's address in Mate), and
 *   once it could not finish, with why. A comment GitHub refuses is tried once more, then logged;
 *   it never moves the task.
 *
 * @module mateTasks
 */
import type { MateTask, MateTaskReport } from "@t3tools/contracts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { changeRoutePath } from "@t3tools/shared/hqChanges";
import type { MateLinkDown } from "@t3tools/shared/mateLink";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type * as Statement from "effect/sql/Statement";

import { Changes } from "./changes.ts";
import { GithubIssues } from "./githubIssues.ts";
import { remoteIdentity } from "./gitTransport.ts";
import { Leader } from "./leader.ts";
import { MateOverviews } from "./mateOverviews.ts";
import { OrgAiKeys } from "./orgAiKeys.ts";
import { Remotes } from "./repoRemotes.ts";
import { Roles } from "./roles.ts";
import { Structure } from "./structure.ts";
import { sourceOfRow } from "./taskSources.ts";

/** How many times a task is handed out before it fails untaken. */
export const TASK_TRIES = 3;

/** Why a task failed that no Mate took, in a person's words, after "No automated Mate could take this up:". */
export const UNTAKEN = "it was handed out three times and never taken in time.";
/** Why a task failed whose Mate is gone. */
export const MATE_GONE = "Its Mate is gone.";
/** Why a task failed whose Mate went offline while on it and stayed away. */
export const MATE_AWAY = "Its Mate went away mid-task.";
/** How long a task's Mates may turn it down before it fails. */
export const DECLINED_FOR = Duration.minutes(30);
/** Why a task failed that its Mates kept turning down, with the last one's reason. */
const declinedTooLong = (reason: string | undefined) =>
  `it was turned down for 30 minutes. The last reason: ${reason?.trim() || "none given."}`;

/**
 * The provider an automated Mate's agents run on with the organization's key, as the Mate's own
 * (`ZeropsAutomation.ts`): Nebius first. Without its key no task is handed out.
 */
const AUTOMATED_PROVIDER = OPENCODE_KEY_PROVIDERS[0]!;

export class MateTasks extends Context.Service<
  MateTasks,
  {
    /** Look again for free Mates: a task waits (`intake.ts`). */
    readonly wake: Effect.Effect<void>;
    /** The `task` frames of the Mate's link: its task now, if it has not taken it, then each one. */
    readonly linkFrames: (projectId: string) => Stream.Stream<string, SqlError>;
    /** The Mate's word on its task (`task-state`). */
    readonly report: (projectId: string, report: MateTaskReport) => Effect.Effect<void>;
  }
>()("@t3tools/hq/mateTasks") {}

const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

interface TaskRow {
  readonly id: string;
  readonly app_id: string;
  readonly source: unknown;
  readonly body: string;
}

const TASK_COLUMNS = "id::text AS id, app_id::text AS app_id, source, body";

/** A task as its Mate is told it; none where its row's source does not read. */
const taskOf = (row: TaskRow): MateTask | undefined => {
  const source = sourceOfRow(row.source);
  return source === undefined ? undefined : { id: row.id, source, body: row.body };
};
/** Its `task` frame, or none (`taskOf`). */
const taskFrame = (row: TaskRow) => {
  const task = taskOf(row);
  return task === undefined ? undefined : encodeDown({ type: "task", task });
};

export interface MateTasksOptions {
  /** How long a Mate has to take a task it was handed; 60 s. */
  readonly acceptWithin?: Duration.Duration;
  /** How often HQ looks for tasks handed out too long ago; 5 s. */
  readonly sweepEvery?: Duration.Duration;
  /** How long a working task's Mate may be offline before the task fails; 2 hours. */
  readonly goneAfter?: Duration.Duration;
}

export const mateTasksLayer = (options: MateTasksOptions = {}) =>
  Layer.effect(
    MateTasks,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const overviews = yield* MateOverviews;
      const structure = yield* Structure;
      const changes = yield* Changes;
      const roles = yield* Roles;
      const remotes = yield* Remotes;
      const github = yield* GithubIssues;
      const aiKeys = yield* OrgAiKeys;
      const layerScope = yield* Effect.scope;
      // One comment at a time, in the order the task moved: GitHub shows them so.
      const telling = yield* Semaphore.make(1);
      const acceptMs = Duration.toMillis(options.acceptWithin ?? Duration.seconds(60));
      const told = yield* PubSub.unbounded<{
        readonly projectId: string;
        readonly frame: string;
      }>();
      const wakes = yield* Queue.sliding<void>(1);
      const wake = Effect.asVoid(Queue.offer(wakes, undefined));
      const leading = Effect.map(leader.status, (status) => status.state === "active");

      /**
       * Whether the Mate's last task's change still waits for review: its copy of the code holds
       * that work, so it takes no new task until the change is merged or closed.
       */
      const heldBy = (mate: Statement.Fragment) => sql`EXISTS (
        SELECT 1 FROM hq_task t JOIN hq_change c ON c.app_id = t.app_id
          AND c.repo = t.change_repo AND c.number = t.change_number
        WHERE t.mate_project_id = ${mate} AND c.state = 'open')`;
      /**
       * The automated Mates, by project, as their records say: only their links and attention move
       * a task, while every Mate's overview moves often.
       */
      let automated: ReadonlySet<string> = new Set();
      /** The Mates held so, as last read: their rows read that task until it is let go. */
      let held: ReadonlySet<string> = new Set();
      /** A change moved: every Mate it holds or let go told, and HQ looks again for free Mates. */
      const changeMoved = Effect.gen(function* () {
        // An HQ with no automated Mate has nothing a change could hold or let go.
        if (automated.size === 0 && held.size === 0) return;
        const rows = yield* sql<{ readonly project_id: string }>`
          SELECT m.project_id FROM hq_mate m WHERE m.automated AND ${heldBy(sql`m.project_id`)}`;
        const now = new Set(rows.map((row) => row.project_id));
        const before = held;
        held = now;
        for (const projectId of new Set([...before, ...now]))
          if (before.has(projectId) !== now.has(projectId)) yield* structure.mateTouched(projectId);
        yield* wake;
      });

      /** A Mate HQ may hand a task to now, of those its records name free. */
      // A Mate that declined a task is not offered one again until this passes: it said it was busy.
      const declinedUntil = new Map<string, number>();
      const freeNow = (projectIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const all = yield* overviews.all;
          const now = yield* Clock.currentTimeMillis;
          return projectIds.filter((projectId) => {
            const entry = all.get(projectId);
            const cooled = (declinedUntil.get(projectId) ?? 0) <= now;
            return cooled && entry?.presence.online === true && entry.attention?.working === 0;
          });
        });

      /**
       * A comment on the task's issue, from its Mate by name, with the repository's token: beside
       * whatever moved the task, tried once more where GitHub refuses it, never failing anything.
       */
      const tell = (
        taskId: string,
        words: (task: {
          readonly mate: string;
          readonly change: string | null;
          readonly detail: string | null;
        }) => string,
      ) =>
        Effect.gen(function* () {
          const [task] = yield* sql<{
            readonly app_id: string;
            readonly repo: string;
            readonly number: number;
            readonly mate_project_id: string | null;
            readonly change_repo: string | null;
            readonly change_number: number | null;
            readonly detail: string | null;
          }>`
            SELECT app_id::text AS app_id, repo, number, mate_project_id, change_repo, change_number,
              detail FROM hq_task WHERE id::text = ${taskId}`;
          if (task === undefined) return;
          const remotesOfApp = yield* sql<{ readonly repo: string; readonly url: string }>`
            SELECT repo, url FROM hq_repo_remote WHERE app_id::text = ${task.app_id} ORDER BY repo`;
          const found = remotesOfApp.find((row) => remoteIdentity(row.url)?.path === task.repo);
          const remote = found === undefined ? undefined : remoteIdentity(found.url);
          if (found === undefined || remote === undefined)
            return yield* Effect.logInfo("a task's comment not posted: no remote", { taskId });
          const name = yield* Effect.orElseSucceed(
            Effect.map(
              roles.view,
              (view) => view.projects.find((project) => project.id === task.mate_project_id)?.name,
            ),
            () => undefined,
          );
          const body = words({
            mate: name || "Mate",
            change:
              task.change_repo === null || task.change_number === null
                ? null
                : `${DEFAULT_HOSTED_APP_URL}${changeRoutePath(task.app_id, task.change_repo, task.change_number)}`,
            detail: task.detail,
          });
          const { token } = yield* remotes.tokenOf({ appId: task.app_id, repo: found.repo });
          const posted = github.comment(remote, token, task.number, body).pipe(
            Effect.filterOrFail(
              (status) => status === 201,
              (status) => ({ _tag: "CommentRefused", status }) as const,
            ),
          );
          yield* posted.pipe(
            Effect.retry({ schedule: Schedule.spaced(Duration.seconds(1)), times: 1 }),
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a task's comment not posted", { taskId, cause }),
          ),
          telling.withPermits(1),
          Effect.forkIn(layerScope),
          Effect.asVoid,
        );
      const pickedUp = (taskId: string) => tell(taskId, ({ mate }) => `${mate} picked this up.`);
      const couldNotFinish = (taskId: string) =>
        tell(
          taskId,
          ({ mate, detail }) =>
            `${mate} couldn't finish this: ${(detail ?? "").trim().slice(0, 2000) || "no reason given."}`,
        );

      /** A task no Mate took, failed on GitHub too: no Mate's name, since none took it. */
      const untaken = (taskId: string) =>
        tell(
          taskId,
          ({ detail }) =>
            `No automated Mate could take this up: ${(detail ?? "").trim().slice(0, 2000) || "no reason given."}`,
        );

      /**
       * Each application's oldest waiting tasks, to its free Mates, one each — none while the
       * organization keeps no key for their provider: they would only turn them down.
       */
      const dispatch = Effect.gen(function* () {
        if (!(yield* leading)) return;
        const keyed = yield* sql`
          SELECT 1 FROM hq_org_ai_key WHERE provider = ${AUTOMATED_PROVIDER.id}`;
        if (keyed.length === 0) return;
        const apps = yield* sql<{ readonly app_id: string }>`
          SELECT DISTINCT app_id::text AS app_id FROM hq_task WHERE state = 'queued'`;
        for (const { app_id: appId } of apps) {
          const idle = yield* sql<{ readonly project_id: string }>`
            SELECT m.project_id FROM hq_mate m
            JOIN hq_app_project p ON p.project_id = m.project_id
            WHERE p.app_id::text = ${appId} AND p.kind IN ('mate', 'devstage') AND m.automated
              AND NOT EXISTS (SELECT 1 FROM hq_task t
                WHERE t.mate_project_id = m.project_id AND t.state IN ('assigned', 'working'))
              AND NOT (${heldBy(sql`m.project_id`)})
            ORDER BY m.seq`;
          const free = yield* freeNow(idle.map((row) => row.project_id));
          if (free.length === 0) continue;
          // Only the intake's own repository's: one it left or stopped gives nobody work.
          const waiting = yield* sql<TaskRow>`
            SELECT ${sql.literal(TASK_COLUMNS)} FROM hq_task t
            WHERE app_id::text = ${appId} AND state = 'queued'
              AND (t.source_kind <> 'github-issue'
                OR EXISTS (SELECT 1 FROM hq_intake i WHERE i.app_id = t.app_id AND i.repo = t.repo))
            ORDER BY seq LIMIT ${free.length}`;
          for (const [index, task] of waiting.entries()) {
            const projectId = free[index]!;
            const handed = yield* leader
              .write(sql`
                UPDATE hq_task SET state = 'assigned', mate_project_id = ${projectId},
                  last_mate_project_id = ${projectId}, assigned_at = now(), updated_at = now()
                WHERE id::text = ${task.id} AND state = 'queued'
                RETURNING 1`)
              .pipe(
                // Another hand gave it a task between the read and this write: it is not free.
                Effect.catchTags({
                  SqlError: (error) =>
                    error.reason._tag === "UniqueViolation"
                      ? Effect.succeed([])
                      : Effect.fail(error),
                }),
              );
            if (handed.length === 0) continue;
            const frame = taskFrame(task);
            if (frame !== undefined) yield* PubSub.publish(told, { projectId, frame });
            yield* structure.mateTouched(projectId);
          }
        }
      });

      /**
       * A handed-out task back to wait, one try more — failed past the last: HQ's word, where the
       * Mate took too long to take it, its link down or not, or its record went.
       */
      const giveBack = (which: "overdue" | "orphaned") =>
        Effect.gen(function* () {
          const where =
            which === "overdue"
              ? sql`assigned_at < now() - make_interval(secs => ${acceptMs / 1000})`
              : sql`NOT EXISTS (SELECT 1 FROM hq_mate m WHERE m.project_id = hq_task.mate_project_id)`;
          const moved = yield* leader.write(sql<{
            readonly id: string;
            readonly mate_project_id: string | null;
            readonly state: string;
          }>`
            WITH back AS (
              SELECT id, mate_project_id AS was FROM hq_task WHERE state = 'assigned' AND ${where}
              FOR UPDATE)
            UPDATE hq_task t SET attempts = t.attempts + 1, updated_at = now(),
              state = CASE WHEN t.attempts + 1 >= ${TASK_TRIES} THEN 'failed' ELSE 'queued' END,
              detail = CASE WHEN t.attempts + 1 >= ${TASK_TRIES} THEN ${UNTAKEN} ELSE t.detail END,
              mate_project_id = NULL,
              assigned_at = CASE WHEN t.attempts + 1 >= ${TASK_TRIES} THEN t.assigned_at END
            FROM back WHERE t.id = back.id
            RETURNING t.id::text AS id, back.was AS mate_project_id, t.state`);
          const now = yield* Clock.currentTimeMillis;
          for (const row of moved) {
            if (row.mate_project_id !== null) {
              // A Mate that let a task's time run out rests as one that declined it would: it is
              // not handed it straight back while its link may already be gone.
              declinedUntil.set(row.mate_project_id, now + acceptMs);
              yield* structure.mateTouched(row.mate_project_id);
            }
            if (row.state === "failed") yield* untaken(row.id);
          }
          if (moved.length > 0) yield* structure.touched;
          return moved.length;
        });

      const goneMs = Duration.toMillis(options.goneAfter ?? Duration.hours(2));
      /** Since when HQ has seen each working task's Mate offline, where its presence says not. */
      const awaySince = new Map<string, number>();
      /** The working tasks whose Mates have been offline past `goneAfter`. */
      const awayTooLong = Effect.gen(function* () {
        const working = yield* sql<{ readonly id: string; readonly mate_project_id: string }>`
          SELECT id::text AS id, mate_project_id FROM hq_task WHERE state = 'working'`;
        const all = yield* overviews.all;
        const now = yield* Clock.currentTimeMillis;
        const seen = new Set<string>();
        const away = working.filter((task) => {
          const presence = all.get(task.mate_project_id)?.presence;
          if (presence?.online === true) return false;
          seen.add(task.mate_project_id);
          // Offline since its presence says, or — one this HQ never saw — since it first looked.
          const since =
            presence === undefined
              ? (awaySince.get(task.mate_project_id) ?? now)
              : Date.parse(presence.since);
          awaySince.set(task.mate_project_id, since);
          return now - since >= goneMs;
        });
        for (const projectId of awaySince.keys())
          if (!seen.has(projectId)) awaySince.delete(projectId);
        return away.map((task) => task.id);
      });

      /**
       * Tasks handed out longer ago than a Mate has to take them, those of Mates gone, and those
       * whose Mates went away mid-task.
       */
      const sweep = Effect.gen(function* () {
        if (!(yield* leading)) return;
        // Most HQs hold no live task: one read, and none of the writes below, each sweep.
        const [live] = yield* sql<{ readonly any: boolean }>`
          SELECT EXISTS (SELECT 1 FROM hq_task WHERE state IN ('assigned', 'working')) AS any`;
        if (live?.any !== true) {
          if (automated.size > 0) yield* wake;
          return;
        }
        yield* giveBack("overdue");
        yield* giveBack("orphaned");
        const failed = yield* leader.write(sql<{ readonly id: string }>`
          UPDATE hq_task SET state = 'failed', detail = ${MATE_GONE}, updated_at = now()
          WHERE state = 'working'
            AND NOT EXISTS (SELECT 1 FROM hq_mate m WHERE m.project_id = hq_task.mate_project_id)
          RETURNING id::text AS id`);
        const away = yield* awayTooLong;
        const left =
          away.length === 0
            ? []
            : yield* leader.write(sql<{ readonly id: string; readonly mate_project_id: string }>`
                UPDATE hq_task SET state = 'failed', detail = ${MATE_AWAY}, updated_at = now()
                WHERE state = 'working' AND id::text IN ${sql.in(away)}
                RETURNING id::text AS id, mate_project_id`);
        for (const row of [...failed, ...left]) yield* couldNotFinish(row.id);
        for (const row of left) yield* structure.mateTouched(row.mate_project_id);
        // Whatever a wake missed waits at most one sweep.
        yield* wake;
      });

      const readAutomated = Effect.map(
        sql<{ readonly project_id: string }>`SELECT project_id FROM hq_mate WHERE automated`,
        (rows) => {
          automated = new Set(rows.map((row) => row.project_id));
        },
      );

      /**
       * A Mate's link or attention moved: look again for free Mates. An untaken task stays its
       * Mate's while its link is down — its word may come on the next — until it is overdue.
       */
      const mateMoved = (projectId: string) => (automated.has(projectId) ? wake : Effect.void);

      /** A step that fails is logged, and the next wake or sweep tries again. */
      const logged =
        (what: string) =>
        <A, E>(effect: Effect.Effect<A, E>) =>
          effect.pipe(
            Effect.asVoid,
            Effect.catchCause((cause) => Effect.logWarning(what, cause)),
          );

      yield* Effect.forkScoped(
        Effect.forever(Effect.andThen(Queue.take(wakes), logged("tasks not dispatched")(dispatch))),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(
            Effect.sleep(options.sweepEvery ?? Duration.seconds(5)),
            logged("tasks not swept")(sweep),
          ),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.concat(Stream.make(""), structure.mateChanges), () =>
          logged("automated Mates not read")(readAutomated),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(overviews.changes, (projectId) =>
          logged("tasks not looked at")(mateMoved(projectId)),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(
          Stream.filter(leader.changes, (status) => status.state === "active"),
          () => wake,
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(changes.changes, () => logged("a change's Mate not told")(changeMoved)),
      );
      // A key kept: the tasks that waited for one go.
      yield* Effect.forkScoped(Stream.runForEach(aiKeys.changes, () => wake));
      yield* Effect.forkScoped(
        Stream.runForEach(changes.taskChanges, (taskId) =>
          tell(taskId, ({ mate, change }) =>
            change === null
              ? `${mate} opened a change for review.`
              : `${mate} opened a change for review: ${change}`,
          ),
        ),
      );

      /**
       * The task is the Mate's: handed to it or taken by it — or, given back while its link was
       * down, waiting for no other Mate yet, as the Mate it was last handed to.
       */
      const owns = (projectId: string) => sql`(
        (mate_project_id = ${projectId} AND state IN ('assigned', 'working'))
        OR (state = 'queued' AND last_mate_project_id = ${projectId}))`;

      /** The Mate's task, as it stands, where the Mate says it is its own. */
      const ownTask = (projectId: string, taskId: string) =>
        Effect.map(
          sql<{ readonly state: string; readonly app_id: string }>`
            SELECT state, app_id::text AS app_id FROM hq_task
            WHERE id::text = ${taskId} AND ${owns(projectId)}`,
          (rows) => rows[0],
        );

      const report = (projectId: string, word: MateTaskReport) =>
        Effect.gen(function* () {
          const task = yield* ownTask(projectId, word.taskId);
          if (task === undefined)
            return yield* Effect.logInfo("a task's word passed by", {
              projectId,
              taskId: word.taskId,
              state: word.state,
            });
          if (word.state === "declined") {
            // Not taken: back to wait for a free Mate, no try against it, this one left alone a
            // while — failed once its Mates have turned it down for `DECLINED_FOR`.
            const declinedSecs = Duration.toSeconds(DECLINED_FOR);
            const [moved] = yield* leader.write(sql<{ readonly state: string }>`
              UPDATE hq_task SET updated_at = now(), mate_project_id = NULL,
                last_mate_project_id = NULL, declined_since = COALESCE(declined_since, now()),
                state = CASE WHEN declined_since < now() - make_interval(secs => ${declinedSecs})
                  THEN 'failed' ELSE 'queued' END,
                detail = CASE WHEN declined_since < now() - make_interval(secs => ${declinedSecs})
                  THEN ${declinedTooLong(word.detail)} ELSE detail END,
                assigned_at = CASE WHEN declined_since < now() - make_interval(secs => ${declinedSecs})
                  THEN assigned_at END
              WHERE id::text = ${word.taskId} AND mate_project_id = ${projectId}
                AND state = 'assigned'
              RETURNING state`);
            if (moved?.state === "failed") {
              yield* untaken(word.taskId);
              yield* structure.touched;
            }
            declinedUntil.set(projectId, (yield* Clock.currentTimeMillis) + acceptMs);
            yield* wake;
          } else if (word.state === "accepted" || word.state === "working") {
            const taken = yield* leader
              .write(sql`
                UPDATE hq_task SET state = 'working', updated_at = now(),
                  mate_project_id = ${projectId}, assigned_at = COALESCE(assigned_at, now()),
                  conversation_id = COALESCE(${word.conversationId ?? null}, conversation_id)
                WHERE id::text = ${word.taskId} AND ${owns(projectId)}
                RETURNING 1`)
              .pipe(
                // A late word from a Mate handed another task since: that one is its own now.
                Effect.catchTags({
                  SqlError: (error) =>
                    error.reason._tag === "UniqueViolation"
                      ? Effect.succeed([])
                      : Effect.fail(error),
                }),
              );
            // Taken once: the first word that moves it from handed (or given back) to worked on.
            if (taken.length > 0 && task.state !== "working") yield* pickedUp(word.taskId);
            if (taken.length > 0 && task.state === "queued") yield* structure.touched;
          } else {
            const ended = yield* leader.write(sql`
              UPDATE hq_task SET state = ${word.state}, updated_at = now(),
                mate_project_id = ${projectId},
                detail = ${word.state === "failed" ? (word.detail ?? null) : null},
                conversation_id = COALESCE(${word.conversationId ?? null}, conversation_id)
              WHERE id::text = ${word.taskId} AND ${owns(projectId)}
              RETURNING 1`);
            if (ended.length > 0 && word.state === "failed") yield* couldNotFinish(word.taskId);
            if (ended.length > 0 && task.state === "queued") yield* structure.touched;
            yield* wake;
          }
          yield* structure.mateTouched(projectId);
        }).pipe(logged("a task's word not kept"));

      return MateTasks.of({
        wake,
        report,
        linkFrames: (projectId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Subscribed before its task is read: a task handed in between is in one or both.
              const live = yield* PubSub.subscribe(told);
              const handed = yield* sql<TaskRow>`
                SELECT ${sql.literal(TASK_COLUMNS)} FROM hq_task
                WHERE mate_project_id = ${projectId} AND state = 'assigned'`;
              return Stream.concat(
                Stream.fromIterable(handed.flatMap((row) => taskFrame(row) ?? [])),
                Stream.fromSubscription(live).pipe(
                  Stream.filter((message) => message.projectId === projectId),
                  Stream.map((message) => message.frame),
                ),
              );
            }),
          ),
      });
    }),
  );
