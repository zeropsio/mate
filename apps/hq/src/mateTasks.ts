/**
 * Tasks from outside, handed to an application's automated Mates (`hq_task`, `@t3tools/contracts`
 * `MateTask`): the leading Core's dispatcher. Tasks come in through one door (`taskIntake.ts`),
 * whatever their source (`taskSources.ts`).
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
 *   then done, failed or stopped — its Mate free again. A word of a task not its own — never handed
 *   to it, or handed to another since — is passed by.
 * - A task whose Mate's record went is given back, or failed where the Mate had taken it; one whose
 *   Mate has been offline for 2 hours while on it fails, saying so.
 * - What is said about a task after it came in (`message`) is kept, and told to its Mate
 *   (`task-message`) once it took it — then, and on each link it opens while on it (it hears each
 *   once). People stopping a task (`stop`) drop it while no Mate took it; one a Mate took, its Mate
 *   is told to stop (`task-stop`, again on each link) and it ends `stopped` on the Mate's word, or
 *   on HQ's after `stopWithin` (10 minutes).
 * - The task's source hears how it stands on ONE status line HQ keeps there through its channel
 *   (`TaskSourceChannels`): its place in the queue (kept true as the queue moves), the Mate that
 *   picked it up, the change it opened, and how it ended — the Mate by name, plain sentences only.
 *   One line at a time, in the order the task moved; a channel's failure never moves a task.
 *
 * @module mateTasks
 */
import type { MateTask, MateTaskLimits, MateTaskMessage, MateTaskReport } from "@t3tools/contracts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { changeRoutePath } from "@t3tools/shared/hqChanges";
import type { MateLinkDown } from "@t3tools/shared/mateLink";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type * as Statement from "effect/sql/Statement";

import { Changes } from "./changes.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { MateOverviews } from "./mateOverviews.ts";
import { OrgAiKeys } from "./orgAiKeys.ts";
import { Roles } from "./roles.ts";
import { Structure } from "./structure.ts";
import { DEFAULT_TASK_LIMITS, readTaskLimits } from "./taskLimits.ts";
import {
  type TaskOnSource,
  TaskSourceChannels,
  type TaskStatus,
  authorOf,
  cleanTaskText,
  sourceOfRow,
} from "./taskSources.ts";

/**
 * The first Mate that reads a task from beyond GitHub (`MateTaskSource` past `github-issue`): an
 * older one passes such a `task` frame by, so it is never handed one.
 */
export const TASK_SOURCES_SINCE = "0.15.158";

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
/** How many messages a task keeps; past them, more are not kept. */
export const TASK_MESSAGES_MAX = 200;
/** Why a task stopped that waited three days for an answer that never came. */
export const NO_ANSWER = "nobody answered its question for three days.";
/** Why a Mate is told to stop a task HQ holds as stopped, where no reason was kept. */
const STOPPED_ALREADY = "This task was stopped.";
/** How long a Mate handed a task people stopped is told to stop it on each link, unheard. */
const STOP_TOLD_FOR_SECS = 24 * 60 * 60;
/** Why a task's Mate stopped it, where the Mate said no reason. */
const STOPPED = "people stopped it.";
/** Why a task failed that its Mates kept turning down, with the last one's reason. */
const declinedTooLong = (reason: string | undefined) =>
  `it was turned down for 30 minutes. The last reason: ${reason?.trim() || "none given."}`;

/**
 * The provider an automated Mate's agents run on with the organization's key, as the Mate's own
 * (`ZeropsAutomation.ts`): Nebius first. Without its key no task is handed out.
 */
const AUTOMATED_PROVIDER = OPENCODE_KEY_PROVIDERS[0]!;

/** What a status line may name of its task. */
export interface TaskFacts {
  /** Its Mate's name, where one took it (or was last handed it). */
  readonly mate: string | null;
  /** Its change's address in Mate, once it has one. */
  readonly change: string | null;
  readonly detail: string | null;
  readonly question: string | null;
}

export class MateTasks extends Context.Service<
  MateTasks,
  {
    /** Look again for free Mates: a task waits (`taskIntake.ts`). */
    readonly wake: Effect.Effect<void>;
    /** The frames of the Mate's link: its task now, what it must hear of it, then each one. */
    readonly linkFrames: (projectId: string) => Stream.Stream<string, SqlError>;
    /** The Mate's word on its task (`task-state`). */
    readonly report: (projectId: string, report: MateTaskReport) => Effect.Effect<void>;
    /** A task came in: its source acknowledges it, and its status line says its place. */
    readonly arrived: (taskId: string) => Effect.Effect<void>;
    /** Something said about the task, kept and told to its Mate once it took it. */
    readonly message: (
      taskId: string,
      message: MateTaskMessage,
    ) => Effect.Effect<void, SqlError | NotLeader>;
    /** People stopped the task: dropped while no Mate took it, else its Mate told to stop. */
    readonly stop: (taskId: string, reason: string) => Effect.Effect<void, SqlError | NotLeader>;
    /**
     * Tasks dropped outside this service (an intake stopped or moved): their status lines say so,
     * and the queue they left moves up.
     */
    readonly dropped: (
      tasks: ReadonlyArray<{ readonly id: string; readonly app_id: string }>,
      why: string,
    ) => Effect.Effect<void>;
  }
>()("@t3tools/hq/mateTasks") {}

interface TaskRow {
  readonly id: string;
  readonly app_id: string;
  readonly source: unknown;
  readonly body: string;
}

const TASK_COLUMNS = "id::text AS id, app_id::text AS app_id, source, body";

const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

/** A task as its Mate is told it, with what it may spend; none where its source does not read. */
const taskOf = (row: TaskRow, limits: MateTaskLimits): MateTask | undefined => {
  const source = sourceOfRow(row.source);
  return source === undefined ? undefined : { id: row.id, source, body: row.body, limits };
};
/** Its `task` frame, or none (`taskOf`). */
const taskFrame = (row: TaskRow, limits: MateTaskLimits) => {
  const task = taskOf(row, limits);
  return task === undefined ? undefined : encodeDown({ type: "task", task });
};

interface MessageRow {
  readonly task_id: string;
  readonly id: string;
  readonly source: MateTaskMessage["from"];
  readonly author: string | null;
  readonly text: string;
}
const messageFrame = (row: MessageRow) =>
  encodeDown({
    type: "task-message",
    taskId: row.task_id,
    message: { id: row.id, from: row.source, author: row.author, text: row.text },
  });

export interface MateTasksOptions {
  /** How long a Mate has to take a task it was handed; 60 s. */
  readonly acceptWithin?: Duration.Duration;
  /** How often HQ looks for tasks handed out too long ago; 5 s. */
  readonly sweepEvery?: Duration.Duration;
  /** How long a working task's Mate may be offline before the task fails; 2 hours. */
  readonly goneAfter?: Duration.Duration;
  /** How long a stopped task's Mate has to say it stopped before HQ ends it; 10 minutes. */
  readonly stopWithin?: Duration.Duration;
  /** How long a task waits for a person's answer before its source asks again; a day. */
  readonly remindAfter?: Duration.Duration;
  /** How long a task waits for an answer before it stops; three days. */
  readonly giveUpAfter?: Duration.Duration;
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
      const aiKeys = yield* OrgAiKeys;
      const channels = yield* TaskSourceChannels;
      const layerScope = yield* Effect.scope;
      // One status line at a time, in the order the task moved: its source shows them so.
      const telling = yield* Semaphore.make(1);
      const acceptMs = Duration.toMillis(options.acceptWithin ?? Duration.seconds(60));
      const told = yield* PubSub.unbounded<{
        readonly projectId: string;
        readonly frame: string;
      }>();
      const tellMate = (projectId: string, frame: string) =>
        Effect.asVoid(PubSub.publish(told, { projectId, frame }));
      const wakes = yield* Queue.sliding<void>(1);
      const wake = Effect.asVoid(Queue.offer(wakes, undefined));
      const leading = Effect.map(leader.status, (status) => status.state === "active");
      /** What each task may spend, as the organization says now (`taskLimits.ts`). */
      const limitsNow = Effect.provideService(readTaskLimits, SqlClient.SqlClient, sql);

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
          return projectIds.flatMap((projectId) => {
            const entry = all.get(projectId);
            const cooled = (declinedUntil.get(projectId) ?? 0) <= now;
            if (!cooled || entry?.presence.online !== true || entry.attention?.working !== 0)
              return [];
            // Only a Mate whose overview says it runs a version that reads them takes tasks from
            // beyond GitHub; one that has not said its version yet takes issues alone.
            const version = entry.overview?.identity.serverVersion;
            const everySource =
              version !== undefined && compareSemverVersions(version, TASK_SOURCES_SINCE) >= 0;
            return [{ projectId, everySource }];
          });
        });

      /**
       * The task's status line on its source, said through its channel with what `status` makes of
       * its facts now: beside whatever moved the task, one at a time, never failing anything.
       */
      const say = (taskId: string, status: (facts: TaskFacts) => TaskStatus | undefined) =>
        Effect.gen(function* () {
          const [task] = yield* sql<{
            readonly app_id: string;
            readonly source: unknown;
            readonly source_key: string;
            readonly status_ref: string | null;
            readonly mate: string | null;
            readonly change_repo: string | null;
            readonly change_number: number | null;
            readonly detail: string | null;
            readonly question: string | null;
          }>`
            SELECT app_id::text AS app_id, source, source_key, status_ref,
              COALESCE(mate_project_id, last_mate_project_id) AS mate, change_repo, change_number,
              detail, question FROM hq_task WHERE id::text = ${taskId}`;
          const source = sourceOfRow(task?.source);
          if (task === undefined || source === undefined) return;
          const channel = yield* channels.of(source.kind);
          if (channel === undefined)
            return yield* Effect.logInfo("a task's status not said: no channel", {
              taskId,
              kind: source.kind,
            });
          const name =
            task.mate === null
              ? null
              : yield* Effect.orElseSucceed(
                  Effect.map(
                    roles.view,
                    (view) =>
                      view.projects.find((project) => project.id === task.mate)?.name || "Mate",
                  ),
                  () => "Mate",
                );
          const said = status({
            mate: name,
            change:
              task.change_repo === null || task.change_number === null
                ? null
                : `${DEFAULT_HOSTED_APP_URL}${changeRoutePath(task.app_id, task.change_repo, task.change_number)}`,
            detail: task.detail,
            question: task.question,
          });
          if (said === undefined) return;
          const onSource: TaskOnSource = {
            taskId,
            appId: task.app_id,
            source,
            sourceKey: task.source_key,
            ...(task.status_ref === null ? {} : { statusRef: task.status_ref }),
          };
          const ref = yield* channel.status(onSource, said);
          if (typeof ref === "string" && ref !== task.status_ref)
            yield* leader.write(sql`
              UPDATE hq_task SET status_ref = ${ref} WHERE id::text = ${taskId}`);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a task's status not said", { taskId, cause }),
          ),
          telling.withPermits(1),
          Effect.forkIn(layerScope),
          Effect.asVoid,
        );
      /**
       * A day into a wait, its source asks again — with a message of its own where its channel
       * can (an edit tells nobody), else by saying the wait again.
       */
      const remind = (taskId: string) =>
        Effect.gen(function* () {
          const [task] = yield* sql<{
            readonly app_id: string;
            readonly source: unknown;
            readonly source_key: string;
            readonly status_ref: string | null;
            readonly question: string | null;
          }>`
            SELECT app_id::text AS app_id, source, source_key, status_ref, question FROM hq_task
            WHERE id::text = ${taskId}`;
          const source = sourceOfRow(task?.source);
          if (task === undefined || source === undefined) return;
          const channel = yield* channels.of(source.kind);
          const question = task.question ?? "an answer.";
          if (channel?.remind === undefined)
            return yield* say(taskId, ({ mate }) => ({
              kind: "waiting",
              mate: mate ?? "Mate",
              question,
            }));
          yield* channel
            .remind(
              {
                taskId,
                appId: task.app_id,
                source,
                sourceKey: task.source_key,
                ...(task.status_ref === null ? {} : { statusRef: task.status_ref }),
              },
              question,
            )
            .pipe(telling.withPermits(1), Effect.forkIn(layerScope));
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a task's reminder not said", { taskId, cause }),
          ),
        );
      const why = (detail: string | null) =>
        (detail ?? "").trim().slice(0, 2000) || "no reason given.";
      const pickedUp = (taskId: string) =>
        say(taskId, ({ mate }) => ({ kind: "picked", mate: mate ?? "Mate" }));
      const couldNotFinish = (taskId: string) =>
        say(taskId, ({ mate, detail }) => ({ kind: "failed", mate, why: why(detail) }));
      /** A task no Mate took, failed on its source too: no Mate's name, since none took it. */
      const untaken = (taskId: string) =>
        say(taskId, ({ detail }) => ({ kind: "failed", mate: null, why: why(detail) }));
      const stoppedSaid = (taskId: string, named: boolean) =>
        say(taskId, ({ mate, detail }) => ({
          kind: "stopped",
          mate: named ? mate : null,
          why: why(detail),
        }));

      /**
       * The application's waiting tasks whose place in its queue moved since their status lines
       * last said it: each says its place now.
       */
      const queueMoved = (appId: string) =>
        Effect.gen(function* () {
          const moved = yield* leader.write(sql<{ readonly id: string; readonly position: number }>`
            WITH places AS (
              SELECT id, row_number() OVER (ORDER BY seq)::int AS position FROM hq_task
              WHERE app_id::text = ${appId} AND state = 'queued')
            UPDATE hq_task t SET told_position = places.position
            FROM places WHERE t.id = places.id
              AND t.told_position IS DISTINCT FROM places.position
            RETURNING t.id::text AS id, places.position`);
          for (const { id, position } of moved)
            yield* say(id, () => ({ kind: "queued", position }));
        });

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
                WHERE t.mate_project_id = m.project_id AND t.state IN ('assigned', 'working', 'waiting'))
              AND NOT (${heldBy(sql`m.project_id`)})
            ORDER BY m.seq`;
          const free = [...(yield* freeNow(idle.map((row) => row.project_id)))];
          if (free.length === 0) continue;
          // An issue's only from the intake's own repository: one it left or stopped gives nobody work.
          const waiting = yield* sql<TaskRow & { readonly source_kind: string }>`
            SELECT ${sql.literal(TASK_COLUMNS)}, source_kind FROM hq_task t
            WHERE app_id::text = ${appId} AND state = 'queued'
              AND (t.source_kind <> 'github-issue'
                OR EXISTS (SELECT 1 FROM hq_intake i WHERE i.app_id = t.app_id AND i.repo = t.repo))
            ORDER BY seq LIMIT ${Math.max(free.length * 4, 20)}`;
          let handedAny = false;
          const limits = yield* limitsNow;
          for (const task of waiting) {
            if (free.length === 0) break;
            // The first free Mate that reads the task; one none of them reads waits for one.
            const at = free.findIndex(
              (mate) => mate.everySource || task.source_kind === "github-issue",
            );
            if (at < 0) continue;
            const projectId = free.splice(at, 1)[0]!.projectId;
            const handed = yield* leader
              .write(sql`
                UPDATE hq_task SET state = 'assigned', mate_project_id = ${projectId},
                  last_mate_project_id = ${projectId}, assigned_at = now(), updated_at = now(),
                  told_position = NULL
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
            handedAny = true;
            const frame = taskFrame(task, limits);
            if (frame !== undefined) yield* tellMate(projectId, frame);
            yield* structure.mateTouched(projectId);
          }
          if (handedAny) yield* queueMoved(appId);
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
            readonly app_id: string;
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
            RETURNING t.id::text AS id, t.app_id::text AS app_id, back.was AS mate_project_id,
              t.state`);
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
          for (const appId of new Set(moved.map((row) => row.app_id))) yield* queueMoved(appId);
          if (moved.length > 0) yield* structure.touched;
          return moved.length;
        });

      const goneMs = Duration.toMillis(options.goneAfter ?? Duration.hours(2));
      const stopSecs = Duration.toSeconds(options.stopWithin ?? Duration.minutes(10));
      const remindSecs = Duration.toSeconds(options.remindAfter ?? Duration.days(1));
      const giveUpSecs = Duration.toSeconds(options.giveUpAfter ?? Duration.days(3));
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
       * Tasks handed out longer ago than a Mate has to take them, those of Mates gone, those whose
       * Mates went away mid-task, and those stopped whose Mates never said they stopped.
       */
      const sweep = Effect.gen(function* () {
        if (!(yield* leading)) return;
        // Most HQs hold no live task: one read, and none of the writes below, each sweep.
        const [live] = yield* sql<{ readonly any: boolean }>`
          SELECT EXISTS (SELECT 1 FROM hq_task WHERE state IN ('assigned', 'working', 'waiting'))
            AS any`;
        if (live?.any !== true) {
          if (automated.size > 0) yield* wake;
          return;
        }
        yield* giveBack("overdue");
        yield* giveBack("orphaned");
        const failed = yield* leader.write(sql<{ readonly id: string }>`
          UPDATE hq_task SET state = 'failed', detail = ${MATE_GONE}, updated_at = now()
          WHERE state IN ('working', 'waiting')
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
        const unheard = yield* leader.write(sql<{
          readonly id: string;
          readonly mate_project_id: string;
        }>`
          UPDATE hq_task SET state = 'stopped', detail = stop_reason, updated_at = now()
          WHERE state IN ('working', 'waiting')
            AND stop_requested_at < now() - make_interval(secs => ${stopSecs})
          RETURNING id::text AS id, mate_project_id`);
        for (const row of unheard) {
          yield* stoppedSaid(row.id, true);
          yield* structure.mateTouched(row.mate_project_id);
        }
        // Waiting for an answer: asked again once after a day, stopped after three.
        const due = yield* leader.write(sql<{ readonly id: string }>`
          UPDATE hq_task SET reminded_at = now()
          WHERE state = 'waiting' AND reminded_at IS NULL AND stop_requested_at IS NULL
            AND waiting_since < now() - make_interval(secs => ${remindSecs})
            AND waiting_since >= now() - make_interval(secs => ${giveUpSecs})
          RETURNING id::text AS id`);
        for (const row of due) yield* remind(row.id);
        const unanswered = yield* sql<{ readonly id: string }>`
          SELECT id::text AS id FROM hq_task
          WHERE state = 'waiting' AND stop_requested_at IS NULL
            AND waiting_since < now() - make_interval(secs => ${giveUpSecs})`;
        for (const row of unanswered) yield* stopTask(row.id, NO_ANSWER);
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
      /** Something said about the task, kept and told to its Mate where it hears it now. */
      const messageTask = (taskId: string, said: MateTaskMessage) =>
        Effect.gen(function* () {
          // The Mate takes a named author only: a blank name is nobody's.
          const message = { ...said, author: authorOf(said.author) };
          const [kept] = yield* leader.write(sql<{
            readonly heard: boolean;
            readonly mate_project_id: string | null;
          }>`
            -- The task's row held while the message is kept: a pickup at the same moment either
            -- sees it (and tells it), or is seen here as taken (and it is told now).
            WITH task AS (
              SELECT t.id, t.mate_project_id, ${hears(sql`t`)} AS heard FROM hq_task t
              WHERE t.id::text = ${taskId}
                AND (SELECT count(*) FROM hq_task_message WHERE task_id::text = ${taskId})
                  < ${TASK_MESSAGES_MAX}
              FOR UPDATE OF t),
            kept AS (
              INSERT INTO hq_task_message (task_id, id, source, author, text)
              SELECT id, ${message.id}, ${message.from}, ${message.author}, ${message.text}
              FROM task ON CONFLICT DO NOTHING RETURNING task_id)
            SELECT task.heard, task.mate_project_id FROM task JOIN kept ON kept.task_id = task.id`);
          if (kept === undefined) return;
          // Told now to a Mate on it — or done with it, its change still waiting for review —
          // and kept for one that has not taken it yet.
          if (kept.mate_project_id !== null && kept.heard)
            yield* tellMate(
              kept.mate_project_id,
              messageFrame({
                task_id: taskId,
                id: message.id,
                source: message.from,
                author: message.author,
                text: message.text,
              }),
            );
        });

      /** People stopped the task: dropped while no Mate took it, else its Mate told to stop. */
      const stopTask = (taskId: string, reason: string) =>
        Effect.gen(function* () {
          const gone = yield* leader.write(sql<{
            readonly app_id: string;
            readonly was: string | null;
          }>`
            WITH gone AS (
              SELECT id, mate_project_id AS was FROM hq_task
              WHERE id::text = ${taskId} AND state IN ('queued', 'assigned')
              FOR UPDATE)
            UPDATE hq_task t SET state = 'dropped', detail = ${reason}, mate_project_id = NULL,
              assigned_at = NULL, updated_at = now()
            FROM gone WHERE t.id = gone.id
            RETURNING t.app_id::text AS app_id, gone.was`);
          for (const row of gone) {
            if (row.was !== null) yield* structure.mateTouched(row.was);
            yield* dropped([{ id: taskId, app_id: row.app_id }], reason);
            yield* structure.touched;
          }
          if (gone.length > 0) return;
          const [taken] = yield* leader.write(sql<{
            readonly mate_project_id: string;
            readonly stop_reason: string;
          }>`
            UPDATE hq_task SET stop_reason = COALESCE(stop_reason, ${reason}),
              stop_requested_at = COALESCE(stop_requested_at, now()), updated_at = now()
            WHERE id::text = ${taskId} AND state IN ('working', 'waiting')
            RETURNING mate_project_id, stop_reason`);
          if (taken !== undefined)
            yield* tellMate(
              taken.mate_project_id,
              encodeDown({ type: "task-stop", taskId, reason: taken.stop_reason }),
            );
        });

      // A person's comment on a task's change: said to the task, for its Mate to hear.
      yield* Effect.forkScoped(
        Stream.runForEach(changes.comments, (comment) =>
          logged("a review comment not told")(
            Effect.gen(function* () {
              const [task] = yield* sql<{ readonly id: string }>`
                SELECT id::text AS id FROM hq_task
                WHERE app_id::text = ${comment.appId} AND change_repo = ${comment.repo}
                  AND change_number = ${comment.number} AND mate_project_id IS NOT NULL
                ORDER BY seq DESC LIMIT 1`;
              if (task === undefined) return;
              const author = yield* Effect.orElseSucceed(
                Effect.map(
                  roles.view,
                  (view) =>
                    view.members.find((member) => member.userId === comment.userId)?.name ?? null,
                ),
                () => null,
              );
              yield* messageTask(task.id, {
                id: `review:${comment.commentId}`,
                from: "review",
                author,
                text: cleanTaskText(comment.body),
              });
            }),
          ),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(changes.taskChanges, (taskId) =>
          say(taskId, ({ mate, change }) =>
            change === null ? undefined : { kind: "change", mate: mate ?? "Mate", link: change },
          ),
        ),
      );

      /**
       * Whether the task's Mate hears what is said of it now: on it, or done with it while its
       * change waits for review (a review comment is for the Mate that made the change).
       */
      const hears = (task: Statement.Fragment) => sql`(
        ${task}.state IN ('working', 'waiting')
        OR (${task}.state = 'done' AND EXISTS (SELECT 1 FROM hq_change c
          WHERE c.app_id = ${task}.app_id AND c.repo = ${task}.change_repo
            AND c.number = ${task}.change_number AND c.state = 'open')))`;

      /** The messages kept of `taskIds`, in the order they came, as frames. */
      const messagesOf = (taskIds: ReadonlyArray<string>) =>
        taskIds.length === 0
          ? Effect.succeed([] as ReadonlyArray<string>)
          : Effect.map(
              sql<MessageRow>`
                SELECT task_id::text AS task_id, id, source, author, text FROM hq_task_message
                WHERE task_id::text IN ${sql.in(taskIds)} ORDER BY seq`,
              (rows) => rows.map(messageFrame),
            );

      /**
       * The task is the Mate's: handed to it or taken by it — or, given back while its link was
       * down, waiting for no other Mate yet, as the Mate it was last handed to — or done by it
       * while its change waits for review (a review comment wakes it there).
       */
      const owns = (projectId: string) => sql`(
        (mate_project_id = ${projectId} AND state IN ('assigned', 'working', 'waiting'))
        OR (state = 'queued' AND last_mate_project_id = ${projectId})
        OR (mate_project_id = ${projectId} AND state = 'done' AND EXISTS (SELECT 1 FROM hq_change c
          WHERE c.app_id = hq_task.app_id AND c.repo = hq_task.change_repo
            AND c.number = hq_task.change_number AND c.state = 'open')))`;

      /** The Mate's task, as it stands, where the Mate says it is its own. */
      const ownTask = (projectId: string, taskId: string) =>
        Effect.map(
          sql<{
            readonly state: string;
            readonly app_id: string;
            readonly question: string | null;
          }>`
            SELECT state, app_id::text AS app_id, question FROM hq_task
            WHERE id::text = ${taskId} AND ${owns(projectId)}`,
          (rows) => rows[0],
        );

      /**
       * A Mate's word on a task not its own now. One people stopped — dropped before it took it,
       * or ended by HQ while it was away — or another Mate's since: a Mate working it is told to
       * stop (the work it does there reaches nobody); its word that it stopped is kept, so it is
       * not told again. Anything else is passed by.
       */
      const strayWord = (projectId: string, word: MateTaskReport) =>
        Effect.gen(function* () {
          if (word.state === "stopped") {
            yield* leader.write(sql`
              UPDATE hq_task SET stop_heard_at = COALESCE(stop_heard_at, now())
              WHERE id::text = ${word.taskId} AND state IN ('stopped', 'dropped')
                AND (mate_project_id = ${projectId} OR last_mate_project_id = ${projectId})`);
          } else if (word.state !== "declined" && word.state !== "failed") {
            const [held] = yield* sql<{ readonly why: string | null }>`
              SELECT COALESCE(stop_reason, detail) AS why FROM hq_task
              WHERE id::text = ${word.taskId} AND (
                (state IN ('stopped', 'dropped')
                  AND (mate_project_id = ${projectId} OR last_mate_project_id = ${projectId}))
                OR (state IN ('assigned', 'working', 'waiting') AND mate_project_id <> ${projectId}))`;
            if (held !== undefined)
              return yield* tellMate(
                projectId,
                encodeDown({
                  type: "task-stop",
                  taskId: word.taskId,
                  reason: held.why?.trim() || STOPPED_ALREADY,
                }),
              );
          }
          yield* Effect.logInfo("a task's word passed by", {
            projectId,
            taskId: word.taskId,
            state: word.state,
          });
        });

      const report = (projectId: string, word: MateTaskReport) =>
        Effect.gen(function* () {
          const task = yield* ownTask(projectId, word.taskId);
          if (task === undefined) return yield* strayWord(projectId, word);
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
            if (moved !== undefined) yield* queueMoved(task.app_id);
            declinedUntil.set(projectId, (yield* Clock.currentTimeMillis) + acceptMs);
            yield* wake;
          } else if (
            word.state === "accepted" ||
            word.state === "working" ||
            word.state === "waiting"
          ) {
            const waiting = word.state === "waiting";
            const question = waiting
              ? cleanTaskText(word.question ?? "")
                  .trim()
                  .slice(0, 2000) || "an answer."
              : null;
            const taken = yield* leader
              .write(sql`
                UPDATE hq_task SET state = ${waiting ? "waiting" : "working"}, updated_at = now(),
                  mate_project_id = ${projectId}, assigned_at = COALESCE(assigned_at, now()),
                  conversation_id = COALESCE(${word.conversationId ?? null}, conversation_id),
                  told_position = NULL, question = ${question},
                  waiting_since = ${waiting ? sql`CASE WHEN state = 'waiting' THEN waiting_since ELSE now() END` : null},
                  reminded_at = ${waiting ? sql`CASE WHEN state = 'waiting' THEN reminded_at END` : null}
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
            const firstTaken = task.state === "assigned" || task.state === "queued";
            // Taken once: the first word that moves it from handed (or given back) to worked on —
            // and what was said of it meanwhile, told now.
            if (taken.length > 0 && firstTaken)
              for (const frame of yield* messagesOf([word.taskId]))
                yield* tellMate(projectId, frame);
            // Its source hears it waits for an answer, or that it is worked on again.
            // (A word said again, as on each link, is no news.)
            if (
              taken.length > 0 &&
              waiting &&
              (task.state !== "waiting" || task.question !== question)
            )
              yield* say(word.taskId, ({ mate, question: asked }) => ({
                kind: "waiting",
                mate: mate ?? "Mate",
                question: asked ?? "an answer.",
              }));
            // Back on it after it was done (a review woke it): the line keeps saying its change.
            else if (
              taken.length > 0 &&
              !waiting &&
              task.state !== "working" &&
              task.state !== "done"
            )
              yield* pickedUp(word.taskId);
            if (taken.length > 0 && task.state === "queued") {
              yield* structure.touched;
              yield* queueMoved(task.app_id);
            }
          } else {
            const ended = yield* leader.write(sql`
              UPDATE hq_task SET state = ${word.state}, updated_at = now(),
                mate_project_id = ${projectId},
                detail = ${
                  word.state === "failed"
                    ? (word.detail ?? null)
                    : word.state === "stopped"
                      ? sql`COALESCE(${word.detail?.trim() || null}, stop_reason, ${STOPPED})`
                      : null
                },
                conversation_id = COALESCE(${word.conversationId ?? null}, conversation_id),
                stop_heard_at = ${word.state === "stopped" ? sql`now()` : sql`stop_heard_at`},
                stop_reason = ${word.state === "done" ? null : sql`stop_reason`},
                question = ${word.state === "done" ? null : sql`question`}
              WHERE id::text = ${word.taskId} AND ${owns(projectId)}
              RETURNING 1`);
            if (ended.length > 0 && word.state === "failed") yield* couldNotFinish(word.taskId);
            if (ended.length > 0 && word.state === "stopped") yield* stoppedSaid(word.taskId, true);
            if (ended.length > 0 && word.state === "done" && task.state !== "done")
              yield* say(word.taskId, ({ mate, change }) => ({
                kind: "done",
                mate: mate ?? "Mate",
                link: change,
              }));
            if (ended.length > 0 && task.state === "queued") {
              yield* structure.touched;
              yield* queueMoved(task.app_id);
            }
            yield* wake;
          }
          yield* structure.mateTouched(projectId);
        }).pipe(logged("a task's word not kept"));

      const dropped = (
        tasks: ReadonlyArray<{ readonly id: string; readonly app_id: string }>,
        why: string,
      ) =>
        Effect.gen(function* () {
          for (const task of tasks)
            yield* say(task.id, () => ({ kind: "stopped", mate: null, why }));
          for (const appId of new Set(tasks.map((task) => task.app_id))) yield* queueMoved(appId);
          if (tasks.length > 0) yield* wake;
        }).pipe(logged("dropped tasks not told"));

      return MateTasks.of({
        wake,
        report,
        dropped,
        arrived: (taskId) =>
          Effect.gen(function* () {
            const [task] = yield* sql<{
              readonly app_id: string;
              readonly source: unknown;
              readonly source_key: string;
            }>`
              SELECT app_id::text AS app_id, source, source_key FROM hq_task
              WHERE id::text = ${taskId}`;
            const source = sourceOfRow(task?.source);
            if (task === undefined || source === undefined) return;
            const channel = yield* channels.of(source.kind);
            if (channel !== undefined)
              yield* channel
                .acknowledge({ taskId, appId: task.app_id, source, sourceKey: task.source_key })
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("a task not acknowledged", { taskId, cause }),
                  ),
                  Effect.forkIn(layerScope),
                );
            yield* queueMoved(task.app_id);
            yield* structure.touched;
            yield* wake;
          }).pipe(logged("a task's arrival not told")),
        message: (taskId, message) => messageTask(taskId, message),
        stop: (taskId, reason) => stopTask(taskId, reason),
        linkFrames: (projectId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Subscribed before its task is read: a task handed in between is in one or both.
              const live = yield* PubSub.subscribe(told);
              const handed = yield* sql<TaskRow>`
                SELECT ${sql.literal(TASK_COLUMNS)} FROM hq_task
                WHERE mate_project_id = ${projectId} AND state = 'assigned'`;
              const limits = handed.length === 0 ? DEFAULT_TASK_LIMITS : yield* limitsNow;
              // On it, or its change waiting for review: what was said of it, and whether people
              // stopped it.
              const on = yield* sql<{ readonly id: string; readonly stop_reason: string | null }>`
                SELECT t.id::text AS id, t.stop_reason FROM hq_task t
                WHERE t.mate_project_id = ${projectId} AND ${hears(sql`t`)}`;
              const said = yield* messagesOf(on.map((task) => task.id));
              // Stopped by people since it was handed it, and not yet heard to have stopped: a
              // Mate away meanwhile may still be on it.
              const ended = yield* sql<{ readonly id: string; readonly why: string | null }>`
                SELECT id::text AS id, COALESCE(stop_reason, detail) AS why FROM hq_task
                WHERE (mate_project_id = ${projectId} OR last_mate_project_id = ${projectId})
                  AND state IN ('stopped', 'dropped') AND stop_heard_at IS NULL
                  AND updated_at > now() - make_interval(secs => ${STOP_TOLD_FOR_SECS})`;
              const stops = [
                ...on.flatMap((task) =>
                  task.stop_reason === null ? [] : [{ id: task.id, why: task.stop_reason }],
                ),
                ...ended,
              ].map((task) =>
                encodeDown({
                  type: "task-stop",
                  taskId: task.id,
                  reason: task.why?.trim() || STOPPED_ALREADY,
                }),
              );
              return Stream.concat(
                Stream.fromIterable([
                  ...handed.flatMap((row) => taskFrame(row, limits) ?? []),
                  ...said,
                  ...stops,
                ]),
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
