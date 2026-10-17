/**
 * Tasks from outside, handed to an application's automated Mates (`hq_task`, `@t3tools/contracts`
 * `MateTask`): the leading Core's dispatcher.
 *
 * - A Mate is free while it is automated, of the application's projects, online, on no task, and
 *   its agents work on nothing (its attention says `working: 0`). The oldest waiting task of an
 *   application goes to a free Mate of it (`assigned`), told over the Mate's link (`task`), and told
 *   again on each link it opens until it takes it. HQ looks again when a task waits, a Mate's link
 *   or attention moves, and a task ends.
 * - A Mate that does not take its task within `acceptWithin` (60 s), or goes offline before it
 *   does, gives it back (`queued`, one try more); the third try that runs out fails it, saying why.
 * - The Mate's word moves its task (`task-state`): taken (`working`, in the conversation it names),
 *   then done or failed — its Mate free again. A word of a task not its own is passed by.
 * - A task whose Mate's record went is given back, or failed where the Mate had taken it.
 *
 * @module mateTasks
 */
import type { MateTask, MateTaskReport } from "@t3tools/contracts";
import type { MateLinkDown } from "@t3tools/shared/mateLink";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { Leader } from "./leader.ts";
import { MateOverviews } from "./mateOverviews.ts";
import { Structure } from "./structure.ts";

/** How many times a task is handed out before it fails untaken. */
export const TASK_TRIES = 3;

/** Why a task failed that no Mate took, in a person's words. */
export const UNTAKEN = "No automated Mate took it up in time, three times over.";
/** Why a task failed whose Mate is gone. */
export const MATE_GONE = "Its Mate is gone.";

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

interface TaskRow {
  readonly id: string;
  readonly app_id: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly author: string | null;
}

const TASK_COLUMNS =
  "id::text AS id, app_id::text AS app_id, repo, number, title, body, url, author";

const taskOf = (row: TaskRow): MateTask => ({
  id: row.id,
  source: {
    kind: "github-issue",
    repo: row.repo,
    number: row.number,
    url: row.url,
    title: row.title,
    author: row.author,
  },
  body: row.body,
});

const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

export interface MateTasksOptions {
  /** How long a Mate has to take a task it was handed; 60 s. */
  readonly acceptWithin?: Duration.Duration;
  /** How often HQ looks for tasks handed out too long ago; 5 s. */
  readonly sweepEvery?: Duration.Duration;
}

export const mateTasksLayer = (options: MateTasksOptions = {}) =>
  Layer.effect(
    MateTasks,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const overviews = yield* MateOverviews;
      const structure = yield* Structure;
      const acceptMs = Duration.toMillis(options.acceptWithin ?? Duration.seconds(60));
      const told = yield* PubSub.unbounded<{
        readonly projectId: string;
        readonly frame: string;
      }>();
      const wakes = yield* Queue.sliding<void>(1);
      const wake = Effect.asVoid(Queue.offer(wakes, undefined));
      const leading = Effect.map(leader.status, (status) => status.state === "active");

      /** A Mate HQ may hand a task to now, of those its records name free. */
      const freeNow = (projectIds: ReadonlyArray<string>) =>
        Effect.map(overviews.all, (all) =>
          projectIds.filter((projectId) => {
            const entry = all.get(projectId);
            return entry?.presence.online === true && entry.attention?.working === 0;
          }),
        );

      /** Each application's oldest waiting tasks, to its free Mates, one each. */
      const dispatch = Effect.gen(function* () {
        if (!(yield* leading)) return;
        const apps = yield* sql<{ readonly app_id: string }>`
          SELECT DISTINCT app_id::text AS app_id FROM hq_task WHERE state = 'queued'`;
        for (const { app_id: appId } of apps) {
          const idle = yield* sql<{ readonly project_id: string }>`
            SELECT m.project_id FROM hq_mate m
            JOIN hq_app_project p ON p.project_id = m.project_id
            WHERE p.app_id::text = ${appId} AND p.kind IN ('mate', 'devstage') AND m.automated
              AND NOT EXISTS (SELECT 1 FROM hq_task t
                WHERE t.mate_project_id = m.project_id AND t.state IN ('assigned', 'working'))
            ORDER BY m.seq`;
          const free = yield* freeNow(idle.map((row) => row.project_id));
          if (free.length === 0) continue;
          const waiting = yield* sql<TaskRow>`
            SELECT ${sql.literal(TASK_COLUMNS)} FROM hq_task
            WHERE app_id::text = ${appId} AND state = 'queued' ORDER BY seq LIMIT ${free.length}`;
          for (const [index, task] of waiting.entries()) {
            const projectId = free[index]!;
            const handed = yield* leader
              .write(sql`
                UPDATE hq_task SET state = 'assigned', mate_project_id = ${projectId},
                  assigned_at = now(), updated_at = now()
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
            yield* PubSub.publish(told, {
              projectId,
              frame: encodeDown({ type: "task", task: taskOf(task) }),
            });
            yield* structure.mateTouched(projectId);
          }
        }
      });

      /**
       * A handed-out task back to wait, one try more — failed past the last: HQ's word, where the
       * Mate's link went before it took it or it took too long.
       */
      const giveBack = (which: "overdue" | "orphaned" | { readonly of: string }) =>
        Effect.gen(function* () {
          const where =
            which === "overdue"
              ? sql`assigned_at < now() - make_interval(secs => ${acceptMs / 1000})`
              : which === "orphaned"
                ? sql`NOT EXISTS (SELECT 1 FROM hq_mate m WHERE m.project_id = hq_task.mate_project_id)`
                : sql`mate_project_id = ${which.of}`;
          const moved = yield* leader.write(sql<{
            readonly mate_project_id: string | null;
            readonly state: string;
          }>`
            WITH back AS (
              SELECT id, mate_project_id AS was FROM hq_task WHERE state = 'assigned' AND ${where}
              FOR UPDATE)
            UPDATE hq_task t SET attempts = t.attempts + 1, updated_at = now(),
              state = CASE WHEN t.attempts + 1 >= ${TASK_TRIES} THEN 'failed' ELSE 'queued' END,
              detail = CASE WHEN t.attempts + 1 >= ${TASK_TRIES} THEN ${UNTAKEN} ELSE t.detail END,
              mate_project_id = CASE WHEN t.attempts + 1 >= ${TASK_TRIES} THEN t.mate_project_id END,
              assigned_at = CASE WHEN t.attempts + 1 >= ${TASK_TRIES} THEN t.assigned_at END
            FROM back WHERE t.id = back.id
            RETURNING back.was AS mate_project_id, t.state`);
          for (const row of moved)
            if (row.mate_project_id !== null) yield* structure.mateTouched(row.mate_project_id);
          if (moved.length > 0) yield* structure.touched;
          return moved.length;
        });

      /** Tasks handed out longer ago than a Mate has to take them, and those of Mates gone. */
      const sweep = Effect.gen(function* () {
        if (!(yield* leading)) return;
        const overdue = yield* giveBack("overdue");
        const orphaned = yield* giveBack("orphaned");
        const failed = yield* leader.write(sql`
          UPDATE hq_task SET state = 'failed', detail = ${MATE_GONE}, updated_at = now()
          WHERE state = 'working'
            AND NOT EXISTS (SELECT 1 FROM hq_mate m WHERE m.project_id = hq_task.mate_project_id)
          RETURNING 1`);
        if (overdue + orphaned + failed.length > 0) yield* wake;
      });

      /** A Mate's link or attention moved: its untaken task back where it went offline. */
      const mateMoved = (projectId: string) =>
        Effect.gen(function* () {
          const entry = (yield* overviews.all).get(projectId);
          if (entry?.presence.online !== true && (yield* leading))
            yield* giveBack({ of: projectId });
          yield* wake;
        });

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
        Stream.runForEach(overviews.changes, (projectId) =>
          logged("a Mate's task not given back")(mateMoved(projectId)),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(
          Stream.filter(leader.changes, (status) => status.state === "active"),
          () => wake,
        ),
      );

      /** The Mate's task, as it stands, where the Mate says it is its own. */
      const ownTask = (projectId: string, taskId: string) =>
        Effect.map(
          sql<{ readonly state: string; readonly app_id: string }>`
            SELECT state, app_id::text AS app_id FROM hq_task
            WHERE id::text = ${taskId} AND mate_project_id = ${projectId}
              AND state IN ('assigned', 'working')`,
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
          if (word.state === "accepted" || word.state === "working") {
            yield* leader.write(sql`
              UPDATE hq_task SET state = 'working', updated_at = now(),
                conversation_id = COALESCE(${word.conversationId ?? null}, conversation_id)
              WHERE id::text = ${word.taskId} AND state IN ('assigned', 'working')`);
          } else {
            yield* leader.write(sql`
              UPDATE hq_task SET state = ${word.state}, updated_at = now(),
                detail = ${word.state === "failed" ? (word.detail ?? null) : null},
                conversation_id = COALESCE(${word.conversationId ?? null}, conversation_id)
              WHERE id::text = ${word.taskId} AND state IN ('assigned', 'working')`);
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
              const untaken = yield* sql<TaskRow>`
                SELECT ${sql.literal(TASK_COLUMNS)} FROM hq_task
                WHERE mate_project_id = ${projectId} AND state = 'assigned'`;
              return Stream.concat(
                Stream.fromIterable(
                  untaken.map((row) => encodeDown({ type: "task", task: taskOf(row) })),
                ),
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
