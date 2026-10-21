/**
 * Tasks from outside, handed to an application's automated Mates (`hq_task`, `@t3tools/contracts`
 * `MateTask`): the leading Core's dispatcher. Tasks come in through one door (`taskIntake.ts`),
 * whatever their source (`taskSources.ts`).
 *
 * - A Mate is free while it is automated, of the application's projects, online, on no task, owes
 *   no follow-up (below), and its agents work on nothing (its attention says `working: 0`). Each
 *   task delivers to a change of its own (`changes.ts`), so a Mate whose changes wait for review is
 *   still free — handed a task only once no free Mate of the application holds none (an older Mate
 *   than `TASK_CHANGES_SINCE`, its one working copy holding that work, is not). The oldest
 *   waiting task of an application goes to a free Mate of it (`assigned`), told over the Mate's
 *   link (`task`), and told again on each link it opens until it takes it. HQ looks again when a
 *   task waits, a Mate's link or attention moves, and a task ends.
 * - Nothing is handed out while the organization keeps no key for the provider automated Mates run
 *   on (`orgAiKeys.ts`): tasks wait, counted as waiting. Nor once this month's spend reached the
 *   organization's monthly budget (`taskLimits.ts`): the waiting tasks' status lines say so (and
 *   only that while it stays spent), those handed out but not taken go back in line, their Mates
 *   told to drop them, and the tasks at work are stopped; a higher budget, or the next month, lets
 *   them go.
 * - Each word of a Mate on its task carries what it cost and how long it worked so far: the most
 *   it said kept on the task, which also keeps when it was taken and when it ended
 *   (`0069_task_costs.sql`); what a word added counts in this month's spend.
 * - A Mate that does not take its task within `acceptWithin` (60 s), its link down or not, gives it
 *   back (`queued`, one try more); the third try that runs out fails it, saying why. Its word, late
 *   on its next link, is still taken while the task waits for no other Mate.
 * - A Mate that turns its task down gives it back with no try against it; once its Mates have
 *   turned it down for 30 minutes it fails, with the last reason.
 * - The Mate's word moves its task (`task-state`): taken (`working`, in the conversation it names),
 *   then done, failed or stopped — its Mate free again. Done, it is back at work on its Mate's word
 *   (a review comment, a person's message in its conversation), and what it delivers then is its
 *   change. A word of a task not its own — never handed to it, or handed to another since — is
 *   passed by.
 * - A task whose Mate's record went is given back, or failed where the Mate had taken it; one whose
 *   Mate has been offline for 2 hours while on it fails, saying so.
 * - What is said about a task after it came in (`message`) is kept, and told to its Mate
 *   (`task-message`, with the task's change) once it took it — then, and on each link it opens
 *   while on it (it hears each once). Said of a task it is done with, its change waiting for
 *   review, it is a follow-up: kept while the Mate is on another task, told once it is on none —
 *   one task's at a time, again on each link it opens — and owed until the Mate says it is back on
 *   it (or `followUpWithin`, 5 minutes, passes with no word), so its work never lands in another
 *   task's. People stopping a task (`stop`) drop it while no Mate took it; one a Mate took, its Mate
 *   is told to stop (`task-stop`, again on each link) and it ends `stopped` on the Mate's word, or
 *   on HQ's after `stopWithin` (10 minutes).
 * - The task's source hears how it stands on ONE status line HQ keeps there through its channel
 *   (`TaskSourceChannels`): its place in the queue (kept true as the queue moves), the Mate that
 *   picked it up, the change it opened, and how it ended — the Mate by name, plain sentences only.
 *   One line at a time, in the order the task moved; a channel's failure never moves a task.
 *   A task that couldn't finish what a review asked last says so on its pull request too, as the
 *   organization's app, where the reviewer wrote.
 *
 * @module mateTasks
 */
import type {
  MateTask,
  MateTaskCommitAuthor,
  MateTaskLimits,
  MateTaskMessage,
  MateTaskReport,
} from "@t3tools/contracts";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { changeRoutePath } from "@t3tools/shared/hqChanges";
import { TASK_CHANGES_SINCE } from "@t3tools/shared/hqIntake";
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
import { GitHost, type MainConflict } from "./gitHost.ts";
import { GithubAuth, botCommitAuthor } from "./githubAuth.ts";
import { marked, statusWords } from "./githubChannel.ts";
import { GithubIssues } from "./githubIssues.ts";
import { remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { MateOverviews } from "./mateOverviews.ts";
import { OrgAiKeys } from "./orgAiKeys.ts";
import { Remotes } from "./repoRemotes.ts";
import { Roles } from "./roles.ts";
import { Structure } from "./structure.ts";
import { DEFAULT_TASK_LIMITS, THIS_MONTH, budgetSpent, readTaskLimits } from "./taskLimits.ts";
import {
  BUDGET_SPENT,
  NO_ANSWER,
  type TaskAnswer,
  type TaskOnSource,
  type TaskPullRequest,
  TaskSourceChannels,
  type TaskStatus,
  authorOf,
  mateNameIn,
  cleanTaskText,
  sourceOfRow,
} from "./taskSources.ts";

/**
 * The first Mate that reads a task from beyond GitHub (`MateTaskSource` past `github-issue`): an
 * older one passes such a `task` frame by, so it is never handed one.
 */
export const TASK_SOURCES_SINCE = "0.15.159";

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
/**
 * Whether `id` is shaped as HQ's task ids are (`hq_task.id`, a uuid): compared as one, so its
 * index is used, and an id of any other shape names no task, never an error.
 */
export const isTaskId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id);
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

/**
 * Where a task is followed in Mate: its own conversation, once its Mate said which one and HQ
 * knows the Mate's environment; until then its Mate's page. The one place a status line, a pull
 * request's footer and a merge's trailer take it from.
 */
export const mateTaskLink = (
  mateProjectId: string,
  conversation?: { readonly environmentId: string; readonly conversationId: string },
) =>
  conversation === undefined
    ? `${DEFAULT_HOSTED_APP_URL}/mate/${encodeURIComponent(mateProjectId)}`
    : `${DEFAULT_HOSTED_APP_URL}/${encodeURIComponent(conversation.environmentId)}/${encodeURIComponent(conversation.conversationId)}`;

/** What a status line may name of its task. */
export interface TaskFacts {
  /** Its Mate's name, where one took it (or was last handed it): its own, not its project's. */
  readonly mate: string | null;
  /** Where it is followed in Mate (`mateTaskLink`), where a Mate took it. */
  readonly link: string | null;
  /** Its change's address in Mate, once it has one. */
  readonly change: string | null;
  /** Its change's number in its repository, once it has one. */
  readonly changeNumber: number | null;
  /** Its change asks for review: its Mate described its head. A draft does not yet. */
  readonly changeReady: boolean;
  /** Its change was merged. */
  readonly changeMerged: boolean;
  /** Its change's pull request on GitHub, once it has one. */
  readonly pullRequest: TaskPullRequest | null;
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
    /**
     * People stopped the task: dropped while no Mate took it, else its Mate told to stop; one done
     * whose change was closed unmerged (its pull request closed) ends stopped.
     */
    readonly stop: (taskId: string, reason: string) => Effect.Effect<void, SqlError | NotLeader>;
    /**
     * The task's status line said anew, with what `status` makes of its facts now (its change's
     * pull request moved): in order with every other line, never failing anything.
     */
    readonly tell: (
      taskId: string,
      status: (facts: TaskFacts) => TaskStatus | undefined,
    ) => Effect.Effect<void>;
    /** Where the task is followed in Mate (`mateTaskLink`); `null` while no Mate took it. */
    readonly link: (taskId: string) => Effect.Effect<string | null>;
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

/**
 * Whether the task is done and its work unsettled: it opened no change, or its change waits for
 * review. A person's message on it, in its conversation or where it came from, wakes it again.
 */
export const doneUnsettled = (sql: SqlClient.SqlClient, task: Statement.Fragment) => sql`(
  ${task}.state = 'done' AND (${task}.change_number IS NULL
    OR EXISTS (SELECT 1 FROM hq_change c
      WHERE c.app_id = ${task}.app_id AND c.repo = ${task}.change_repo
        AND c.number = ${task}.change_number AND c.state = 'open')))`;

/**
 * Whether the task's Mate hears what is said of it now: on it, or done with its work unsettled (a
 * review comment, or a reply where the task came from, is for the Mate that did the task).
 */
export const taskHears = (sql: SqlClient.SqlClient, task: Statement.Fragment) => sql`(
  ${task}.state IN ('working', 'waiting') OR ${doneUnsettled(sql, task)})`;

/** Whether what is said of the task is kept for it: its Mate hears it now, or once it takes it. */
export const taskListens = (sql: SqlClient.SqlClient, task: Statement.Fragment) =>
  sql`(${task}.state IN ('queued', 'assigned') OR ${taskHears(sql, task)})`;

/** Who a word on a task's change from HQ itself is by: no person wrote it. */
export const HQ_AUTHOR = "HQ";

/** How many of a conflict's files its message names; the rest it counts. */
const CONFLICT_PATHS_NAMED = 8;

/**
 * What a task's Mate is told when `main` moved under its change and the change no longer merges:
 * what landed, the files both changed, and to merge `main` in — never to rebase: a change's branch
 * only moves forward, here and on GitHub.
 */
export const mainMovedWords = (conflict: Pick<MainConflict, "landed" | "paths">): string => {
  const named = conflict.paths.slice(0, CONFLICT_PATHS_NAMED).join(", ");
  const more = conflict.paths.length - CONFLICT_PATHS_NAMED;
  const files =
    conflict.paths.length === 0
      ? ""
      : ` (conflicts in ${named}${more > 0 ? ` and ${String(more)} more` : ""})`;
  const moved = conflict.landed === null ? "main moved" : `main moved: ‘${conflict.landed}’ landed`;
  return `${moved} and your change no longer merges cleanly${files}. Fetch origin, merge origin/main into your change (never rebase), resolve each conflict keeping both changes' intent, run the checks and deliver it again.`;
};

const TASK_COLUMNS = "id::text AS id, app_id::text AS app_id, source, body";

const encodeDown = (message: MateLinkDown) => JSON.stringify(message);

/**
 * A task as its Mate is told it, with what it may spend and who its commits are by, where HQ
 * knows; none where its source does not read.
 */
const taskOf = (
  row: TaskRow,
  limits: MateTaskLimits,
  commitAuthor: MateTaskCommitAuthor | undefined,
): MateTask | undefined => {
  const source = sourceOfRow(row.source);
  return source === undefined
    ? undefined
    : {
        id: row.id,
        source,
        body: row.body,
        limits,
        ...(commitAuthor === undefined ? {} : { commitAuthor }),
      };
};
/** Its `task` frame, or none (`taskOf`). */
const taskFrame = (
  row: TaskRow,
  limits: MateTaskLimits,
  commitAuthor: MateTaskCommitAuthor | undefined,
) => {
  const task = taskOf(row, limits, commitAuthor);
  return task === undefined ? undefined : encodeDown({ type: "task", task });
};

interface MessageRow {
  readonly task_id: string;
  readonly id: string;
  readonly source: MateTaskMessage["from"];
  readonly author: string | null;
  readonly text: string;
  /** The task's change, where it opened one, and its branch. */
  readonly change_repo: string | null;
  readonly change_number: number | null;
  readonly change_branch: string | null;
}
/** A message as its Mate is told it, with its task's change: where a follow-up's work starts. */
const messageFrame = (row: MessageRow) =>
  encodeDown({
    type: "task-message",
    taskId: row.task_id,
    message: { id: row.id, from: row.source, author: row.author, text: row.text },
    ...(row.change_repo === null || row.change_number === null || row.change_branch === null
      ? {}
      : {
          change: { repo: row.change_repo, number: row.change_number, branch: row.change_branch },
        }),
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
  /**
   * How long a Mate told a follow-up on a task it is done with has to say it is back on it, while
   * it takes no new task: its working copies move to the task's change first; 5 minutes.
   */
  readonly followUpWithin?: Duration.Duration;
}

export const mateTasksLayer = (options: MateTasksOptions = {}) =>
  Layer.effect(
    MateTasks,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const overviews = yield* MateOverviews;
      /** A task's link, by its Mate's environment as its overview names it and the conversation it said. */
      const linkTo = (mate: string, conversationId: string | null) =>
        Effect.map(overviews.all, (all) => {
          const environmentId = all.get(mate)?.overview?.identity.environmentId;
          return mateTaskLink(
            mate,
            environmentId === undefined || conversationId === null
              ? undefined
              : { environmentId, conversationId },
          );
        });
      const structure = yield* Structure;
      const changes = yield* Changes;
      const gitHost = yield* GitHost;
      const roles = yield* Roles;
      const aiKeys = yield* OrgAiKeys;
      const channels = yield* TaskSourceChannels;
      const layerScope = yield* Effect.scope;
      // One status line at a time, in the order the task moved: its source shows them so.
      const telling = yield* Semaphore.make(1);
      const acceptMs = Duration.toMillis(options.acceptWithin ?? Duration.seconds(60));
      const followUpSecs = Duration.toSeconds(options.followUpWithin ?? Duration.minutes(5));
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
      const overBudget = Effect.provideService(budgetSpent, SqlClient.SqlClient, sql);
      const github = yield* GithubAuth;
      const githubIssues = yield* GithubIssues;
      const remotes = yield* Remotes;
      /**
       * Who the commits of the application's tasks are by: the organization's app's bot, where a
       * repository of the application is mirrored through the app (its bot read once, then kept
       * with the app). None otherwise, and none while HQ cannot tell: the task goes out anyway.
       */
      const commitAuthorOf = (appId: string) =>
        Effect.gen(function* () {
          const [through] = yield* sql`
            SELECT 1 FROM hq_repo_remote WHERE app_id::text = ${appId} AND via = 'app' LIMIT 1`;
          if (through === undefined) return undefined;
          const bot = yield* github.bot;
          return bot === undefined ? undefined : botCommitAuthor(bot);
        }).pipe(
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("a task goes out with no commit author: its bot is not known", {
                appId,
                reason: error._tag === "GithubAuthUnavailable" ? error.reason : error._tag,
              }),
              undefined,
            ),
          ),
        );

      /**
       * Whether the task's Mate hears what is said of it now: on it, or done with its work
       * unsettled (a review comment is for the Mate that made the change).
       */
      const hears = (task: Statement.Fragment) => taskHears(sql, task);

      /** The messages kept of `taskIds`, in the order they came, as frames. */
      const messagesOf = (taskIds: ReadonlyArray<string>, sinceEnded = false) =>
        taskIds.length === 0
          ? Effect.succeed([] as ReadonlyArray<string>)
          : Effect.map(
              sql<MessageRow>`
                SELECT m.task_id::text AS task_id, m.id, m.source, m.author, m.text,
                  t.change_repo, t.change_number, c.branch AS change_branch
                FROM hq_task_message m JOIN hq_task t ON t.id = m.task_id
                LEFT JOIN hq_change c ON c.app_id = t.app_id AND c.repo = t.change_repo
                  AND c.number = t.change_number
                WHERE m.task_id::text IN ${sql.in(taskIds)}
                  AND (NOT ${sinceEnded} OR m.created_at > ${endedAt(sql`t`)})
                ORDER BY m.seq`,
              (rows) => rows.map(messageFrame),
            );

      /**
       * Whether a task of the Mate's has its change waiting for review: its row reads that task
       * while it is on no other.
       */
      const heldBy = (mate: Statement.Fragment) => sql`EXISTS (
        SELECT 1 FROM hq_task t JOIN hq_change c ON c.app_id = t.app_id
          AND c.repo = t.change_repo AND c.number = t.change_number
        WHERE t.mate_project_id = ${mate} AND c.state = 'open')`;
      /** Whether the Mate holds a change waiting for review, a task's or its own: free last. */
      const holdsChange = (mate: Statement.Fragment) => sql`EXISTS (
        SELECT 1 FROM hq_change c WHERE c.mate_project_id = ${mate} AND c.state = 'open')`;
      /** When the task last ended, for what was said of it since. */
      const endedAt = (task: Statement.Fragment) =>
        sql`COALESCE(${task}.ended_at, ${task}.updated_at)`;
      /**
       * A follow-up on a task the Mate is done with, its work unsettled: something said of it
       * since it ended — not told yet, or told within `followUpWithin` (`follow_up_at`) with no
       * word that the Mate is back on it. The Mate owes it: no new task until it is back on that
       * one, or the time passed with no word.
       */
      const followUpOn = (task: Statement.Fragment) => sql`(
        ${pendingOn(task)} AND (${untold(task)}
          OR ${task}.follow_up_at > now() - make_interval(secs => ${followUpSecs})))`;
      /**
       * Something said of a task the Mate is done with, its work unsettled, since it ended: told
       * or not, what a link opening tells it, however long its Mate was away.
       */
      const pendingOn = (task: Statement.Fragment) => sql`(
        ${doneUnsettled(sql, task)} AND ${task}.mate_project_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM hq_task_message msg WHERE msg.task_id = ${task}.id
          AND msg.created_at > ${endedAt(task)}))`;
      /** Said of the task since it ended, and since HQ last told its Mate a follow-up on it. */
      const untold = (task: Statement.Fragment) => sql`EXISTS (
        SELECT 1 FROM hq_task_message msg WHERE msg.task_id = ${task}.id
          AND msg.created_at > GREATEST(${endedAt(task)},
            COALESCE(${task}.follow_up_at, '-infinity'::timestamptz)))`;
      /** Whether the Mate is on a task: handed it, at work on it, or asking about it. */
      const onATask = (mate: Statement.Fragment) => sql`EXISTS (SELECT 1 FROM hq_task live
        WHERE live.mate_project_id = ${mate} AND live.state IN ('assigned', 'working', 'waiting'))`;
      /**
       * Each automated Mate's one follow-up to tell now — of the tasks it is done with, the one
       * said of first — once it is on no task: one task's work at a time, on its own change.
       * `all` tells it again (a link opening): any said of since its task ended, told before or
       * not; else only one with something not told yet.
       */
      const followUps = (mates: Statement.Fragment, all: boolean) =>
        Effect.gen(function* () {
          const owed = sql`
              SELECT DISTINCT ON (t.mate_project_id) t.id, t.mate_project_id,
                ${untold(sql`t`)} AS untold
              FROM hq_task t JOIN hq_task_message msg ON msg.task_id = t.id
              WHERE t.mate_project_id IN (SELECT project_id FROM hq_mate WHERE automated AND ${mates})
                AND ${all ? pendingOn(sql`t`) : followUpOn(sql`t`)}
                AND NOT ${onATask(sql`t.mate_project_id`)}
                AND msg.created_at > ${endedAt(sql`t`)}
              ORDER BY t.mate_project_id, msg.seq`;
          // Read first: most looks find none, and write nothing.
          const found = yield* sql<{ readonly untold: boolean }>`SELECT untold FROM (${owed}) o`;
          if (!found.some((row) => row.untold || all)) return [];
          const due = yield* leader.write(sql<{
            readonly task_id: string;
            readonly mate_project_id: string;
          }>`
            WITH due AS (${owed})
            UPDATE hq_task t SET follow_up_at = now() FROM due
            WHERE t.id = due.id AND (due.untold OR ${all})
            RETURNING t.id::text AS task_id, t.mate_project_id`);
          for (const row of due)
            for (const frame of yield* messagesOf([row.task_id], true))
              yield* tellMate(row.mate_project_id, frame);
          return due;
        });
      /**
       * The automated Mates, by project, as their records say: only their links and attention move
       * a task, while every Mate's overview moves often.
       */
      let automated: ReadonlySet<string> = new Set();
      /** The Mates held so, as last read: their rows read that task until it is let go. */
      let held: ReadonlySet<string> = new Set();
      /**
       * Replies kept for a task while its Mate worked another, its change merged or closed before
       * the Mate got to them: each source says how the task ended, once per end (`end_answered_at`,
       * as a reply after its end is answered), never silence. What was said in HQ's own review
       * reads the change's fate there.
       */
      const unheardEnds = Effect.gen(function* () {
        const ended = yield* leader.write(sql<{
          readonly id: string;
          readonly app_id: string;
          readonly source: unknown;
          readonly source_key: string;
          readonly state: string;
          readonly why: string | null;
        }>`
          UPDATE hq_task t SET end_answered_at = t.ended_at
          WHERE t.state IN ('done', 'stopped') AND t.ended_at IS NOT NULL
            AND t.end_answered_at IS DISTINCT FROM t.ended_at
            AND EXISTS (SELECT 1 FROM hq_change c WHERE c.app_id = t.app_id
              AND c.repo = t.change_repo AND c.number = t.change_number AND c.state <> 'open')
            AND EXISTS (SELECT 1 FROM hq_task_message msg WHERE msg.task_id = t.id
              AND msg.source <> 'review'
              AND msg.created_at > GREATEST(t.ended_at,
                COALESCE(t.follow_up_at, '-infinity'::timestamptz)))
          RETURNING t.id::text AS id, t.app_id::text AS app_id, t.source, t.source_key, t.state,
            COALESCE(t.detail, t.stop_reason) AS why`);
        for (const task of ended) {
          const source = sourceOfRow(task.source);
          if (source === undefined) continue;
          const channel = yield* channels.of(source.kind);
          yield* (
            channel?.answerEnd?.(
              { taskId: task.id, appId: task.app_id, source, sourceKey: task.source_key },
              task.state === "done" ? { kind: "finished" } : { kind: "stopped", why: task.why },
            ) ?? Effect.void
          );
        }
      });

      /** A change moved: every Mate it holds or let go told, and HQ looks again for free Mates. */
      const changeMoved = Effect.gen(function* () {
        // An HQ with no automated Mate has nothing a change could hold or let go.
        if (automated.size === 0 && held.size === 0) return;
        yield* unheardEnds.pipe(Effect.catchTags({ NotLeader: () => Effect.void }));
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
      const freeNow = (
        mates: ReadonlyArray<{ readonly project_id: string; readonly held: boolean }>,
      ) =>
        Effect.gen(function* () {
          const all = yield* overviews.all;
          const now = yield* Clock.currentTimeMillis;
          return mates.flatMap(({ project_id: projectId, held }) => {
            const entry = all.get(projectId);
            const cooled = (declinedUntil.get(projectId) ?? 0) <= now;
            if (!cooled || entry?.presence.online !== true || entry.attention?.working !== 0)
              return [];
            // Only a Mate whose overview says it runs a version that reads them takes tasks from
            // beyond GitHub; one that has not said its version yet takes issues alone.
            const version = entry.overview?.identity.serverVersion;
            const since = (first: string) =>
              version !== undefined && compareSemverVersions(version, first) >= 0;
            // One whose task's change waits for review takes another only where it moves its
            // working copies to each task's base.
            if (held && !since(TASK_CHANGES_SINCE)) return [];
            return [{ projectId, everySource: since(TASK_SOURCES_SINCE) }];
          });
        });

      /** Words said on a change's pull request, as the organization's app; none where it is not. */
      const onPullRequest = (
        ref: { readonly appId: string; readonly repo: string },
        repository: string,
        number: number,
        words: string,
      ) =>
        Effect.gen(function* () {
          const remote = remoteIdentity(`https://github.com/${repository}`);
          const reached = yield* remotes.tokenOf(ref, "pullRequests", "act");
          if (remote === undefined || reached.as !== "app") return;
          const posted = yield* githubIssues.comment(remote, reached.token, number, marked(words));
          if (posted.status !== 201)
            yield* Effect.logInfo("a pull request's line not said", { status: posted.status });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a pull request's line not said", { cause }),
          ),
        );

      /**
       * The task's status line on its source, said through its channel with what `status` makes of
       * its facts now — then, where `answer` makes one of them, its ending's words as a new message:
       * beside whatever moved the task, one at a time, never failing anything.
       */
      const say = (
        taskId: string,
        status: (facts: TaskFacts) => TaskStatus | undefined,
        answer?: (facts: TaskFacts) => TaskAnswer,
      ) =>
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
            readonly app_name: string | null;
            readonly pr_number: number | null;
            readonly pr_url: string | null;
            readonly conversation_id: string | null;
            readonly change_ready: boolean;
            readonly change_state: string | null;
            readonly pr_repository: string | null;
            readonly last_from: string | null;
          }>`
            SELECT t.app_id::text AS app_id, t.source, t.source_key, t.status_ref,
              COALESCE(t.mate_project_id, t.last_mate_project_id) AS mate, t.conversation_id,
              t.change_repo,
              t.change_number, t.detail, t.question, a.name AS app_name, pr.pr_number,
              pr.url AS pr_url, COALESCE(c.ready_head = c.head, false) AS change_ready,
              c.state AS change_state, pr.github_repo AS pr_repository,
              (SELECT m.source FROM hq_task_message m WHERE m.task_id = t.id
                ORDER BY m.seq DESC LIMIT 1) AS last_from
            FROM hq_task t
            LEFT JOIN hq_app a ON a.id = t.app_id
            LEFT JOIN hq_change c ON c.app_id = t.app_id AND c.repo = t.change_repo
              AND c.number = t.change_number
            LEFT JOIN hq_pull_request pr ON pr.app_id = t.app_id AND pr.repo = t.change_repo
              AND pr.number = t.change_number
            WHERE t.id::text = ${taskId}`;
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
                  Effect.map(roles.view, (view) => {
                    const project = view.projects.find((found) => found.id === task.mate);
                    return project === undefined
                      ? "Mate"
                      : mateNameIn(project.name, task.app_name) || "Mate";
                  }),
                  () => "Mate",
                );
          const facts: TaskFacts = {
            mate: name,
            link: task.mate === null ? null : yield* linkTo(task.mate, task.conversation_id),
            pullRequest:
              task.pr_number === null || task.pr_url === null
                ? null
                : { number: task.pr_number, url: task.pr_url },
            change:
              task.change_repo === null || task.change_number === null
                ? null
                : `${DEFAULT_HOSTED_APP_URL}${changeRoutePath(task.app_id, task.change_repo, task.change_number)}`,
            changeNumber: task.change_repo === null ? null : task.change_number,
            changeReady: task.change_ready,
            changeMerged: task.change_state === "merged",
            detail: task.detail,
            question: task.question,
          };
          const said = status(facts);
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
          if (answer !== undefined && channel.answer !== undefined)
            yield* channel.answer(onSource, answer(facts));
          // What a review asked and the Mate couldn't finish: said where the reviewer wrote too.
          if (
            said.kind === "failed" &&
            task.last_from === "review" &&
            task.change_repo !== null &&
            task.pr_number !== null &&
            task.pr_repository !== null
          )
            yield* onPullRequest(
              { appId: task.app_id, repo: task.change_repo },
              task.pr_repository,
              task.pr_number,
              statusWords(said),
            );
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
        say(taskId, ({ mate, link }) => ({
          kind: "picked",
          mate: mate ?? "Mate",
          ...(link === null ? {} : { link }),
        }));
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
          // While the budget is spent, the waiting say so, never a place the next look takes back.
          if (yield* overBudget) return yield* budgetHeld;
          const moved = yield* leader.write(sql<{ readonly id: string; readonly position: number }>`
            WITH places AS (
              SELECT id, row_number() OVER (ORDER BY seq)::int AS position FROM hq_task
              WHERE app_id = ${appId}::uuid AND state = 'queued')
            UPDATE hq_task t SET told_position = places.position
            FROM places WHERE t.id = places.id
              AND t.told_position IS DISTINCT FROM places.position
            RETURNING t.id::text AS id, places.position`);
          for (const { id, position } of moved)
            yield* say(id, () => ({ kind: "queued", position }));
        });

      /**
       * Each waiting task's status line says the budget is spent, once (`told_position` 0: no place
       * said, so the first move of its queue once the budget is no longer spent says its place).
       */
      const budgetHeld = Effect.gen(function* () {
        const waiting = yield* leader.write(sql<{ readonly id: string }>`
          UPDATE hq_task SET told_position = 0
          WHERE state = 'queued' AND told_position IS DISTINCT FROM 0
          RETURNING id::text AS id`);
        for (const { id } of waiting) yield* say(id, () => ({ kind: "budget" }));
      });

      /**
       * This month's budget is spent: each task handed out but not taken goes back in line, no try
       * against it, its Mate told to drop it (it may take it again once the budget lets it go);
       * each task at work is stopped (once); and the waiting say why they wait.
       */
      const budgetReached = Effect.gen(function* () {
        const back = yield* leader.write(sql<{ readonly id: string; readonly was: string }>`
          WITH back AS (
            SELECT id, mate_project_id AS was FROM hq_task WHERE state = 'assigned' FOR UPDATE)
          UPDATE hq_task t SET state = 'queued', mate_project_id = NULL,
            last_mate_project_id = NULL, assigned_at = NULL, told_position = NULL,
            updated_at = now()
          FROM back WHERE t.id = back.id
          RETURNING t.id::text AS id, back.was`);
        for (const { id, was } of back) {
          yield* tellMate(
            was,
            encodeDown({ type: "task-stop", taskId: id, reason: BUDGET_SPENT, requeued: true }),
          );
          yield* structure.mateTouched(was);
        }
        if (back.length > 0) yield* structure.touched;
        const working = yield* sql<{ readonly id: string }>`
          SELECT id::text AS id FROM hq_task
          WHERE state IN ('working', 'waiting') AND stop_requested_at IS NULL`;
        for (const { id } of working) yield* stopTask(id, BUDGET_SPENT);
        yield* budgetHeld;
      });

      /**
       * Each application's oldest waiting tasks, to its free Mates, one each — none while the
       * organization keeps no key for their provider: they would only turn them down.
       */
      const dispatch = Effect.gen(function* () {
        if (!(yield* leading)) return;
        // A Mate on no task first hears the follow-up it owes, whatever the key or the budget —
        // one whose link is open: one away hears it as its link opens.
        const present = yield* overviews.all;
        const online = [...automated].filter((id) => present.get(id)?.presence.online === true);
        if (online.length > 0) yield* followUps(sql`project_id IN ${sql.in(online)}`, false);
        const keyed = yield* sql`
          SELECT 1 FROM hq_org_ai_key WHERE provider = ${AUTOMATED_PROVIDER.id}`;
        if (keyed.length === 0) return;
        if (yield* overBudget) return yield* budgetReached;
        // The budget no longer spent: the tasks whose lines said it was say their places again.
        const told = yield* sql<{ readonly app_id: string }>`
          SELECT DISTINCT app_id::text AS app_id FROM hq_task
          WHERE state = 'queued' AND told_position = 0`;
        for (const { app_id: appId } of told) yield* queueMoved(appId);
        const apps = yield* sql<{ readonly app_id: string }>`
          SELECT DISTINCT app_id::text AS app_id FROM hq_task WHERE state = 'queued'`;
        for (const { app_id: appId } of apps) {
          const idle = yield* sql<{ readonly project_id: string; readonly held: boolean }>`
            SELECT m.project_id, ${heldBy(sql`m.project_id`)} AS held FROM hq_mate m
            JOIN hq_app_project p ON p.project_id = m.project_id
            WHERE p.app_id::text = ${appId} AND p.kind IN ('mate', 'devstage') AND m.automated
              AND NOT ${onATask(sql`m.project_id`)}
              AND NOT EXISTS (SELECT 1 FROM hq_task t
                WHERE t.mate_project_id = m.project_id AND ${followUpOn(sql`t`)})
            ORDER BY ${holdsChange(sql`m.project_id`)}, m.seq`;
          const free = [...(yield* freeNow(idle))];
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
          // Read once a task of the application is handed out, the same for each.
          let commitAuthor: { readonly is: MateTaskCommitAuthor | undefined } | undefined;
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
            commitAuthor ??= { is: yield* commitAuthorOf(appId) };
            const frame = taskFrame(task, limits, commitAuthor.is);
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
      /**
       * Something said about the task, kept and told to its Mate while it is on it. One for a task
       * it is done with, its change waiting for review, is a follow-up: told once its Mate is on
       * no other task (`followUps`), so it never lands in another task's work.
       */
      const messageTask = (taskId: string, said: MateTaskMessage) =>
        Effect.gen(function* () {
          // The Mate takes a named author only: a blank name is nobody's.
          const message = { ...said, author: authorOf(said.author) };
          const [kept] = yield* leader.write(sql<
            MessageRow & {
              readonly on: boolean;
              readonly follow_up: boolean;
              readonly mate_project_id: string | null;
            }
          >`
            -- The task's row held while the message is kept: a pickup at the same moment either
            -- sees it (and tells it), or is seen here as taken (and it is told now).
            WITH task AS (
              SELECT t.id, t.mate_project_id, t.change_repo, t.change_number,
                t.state IN ('working', 'waiting') AS on,
                ${hears(sql`t`)} AND t.state = 'done' AS follow_up,
                (SELECT c.branch FROM hq_change c WHERE c.app_id = t.app_id
                  AND c.repo = t.change_repo AND c.number = t.change_number) AS change_branch
              FROM hq_task t
              WHERE t.id::text = ${taskId}
                AND (SELECT count(*) FROM hq_task_message WHERE task_id::text = ${taskId})
                  < ${TASK_MESSAGES_MAX}
              FOR UPDATE OF t),
            kept AS (
              INSERT INTO hq_task_message (task_id, id, source, author, text)
              SELECT id, ${message.id}, ${message.from}, ${message.author}, ${message.text}
              FROM task ON CONFLICT DO NOTHING RETURNING task_id)
            SELECT task.on, task.follow_up, task.mate_project_id, task.id::text AS task_id,
              ${message.id} AS id, ${message.from} AS source, ${message.author}::text AS author,
              ${message.text} AS text, task.change_repo, task.change_number, task.change_branch
            FROM task JOIN kept ON kept.task_id = task.id`);
          if (kept === undefined) return;
          // Told now to a Mate on it, kept for one that has not taken it yet; a follow-up goes
          // out with HQ's next look, once its Mate is on nothing else.
          if (kept.mate_project_id !== null && kept.on)
            yield* tellMate(kept.mate_project_id, messageFrame(kept));
          else if (kept.follow_up) yield* wake;
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
          if (taken !== undefined) {
            // Its Mate's row says it is stopping until the Mate says it stopped.
            yield* structure.mateTouched(taken.mate_project_id);
            return yield* tellMate(
              taken.mate_project_id,
              encodeDown({ type: "task-stop", taskId, reason: taken.stop_reason }),
            );
          }
          // Done, its change closed without merging: the work went nowhere, so the task ends
          // stopped, and its Mate, on nothing, hears nothing.
          const ended = yield* leader.write(sql<{ readonly mate_project_id: string | null }>`
            UPDATE hq_task t SET state = 'stopped', detail = ${reason}, updated_at = now(),
              stop_heard_at = now()
            WHERE t.id::text = ${taskId} AND t.state = 'done' AND EXISTS (
              SELECT 1 FROM hq_change c WHERE c.app_id = t.app_id AND c.repo = t.change_repo
                AND c.number = t.change_number AND c.state = 'closed')
            RETURNING t.mate_project_id`);
          for (const row of ended) {
            yield* stoppedSaid(taskId, true);
            if (row.mate_project_id !== null) yield* structure.mateTouched(row.mate_project_id);
            yield* wake;
          }
        });

      // A person's comment on a task's change: said to the task, for its Mate to hear.
      yield* Effect.forkScoped(
        Stream.runForEach(changes.comments, (comment) =>
          logged("a review comment not told")(
            Effect.gen(function* () {
              // The task the change was opened on, else the one it is linked to.
              const [task] = yield* sql<{ readonly id: string }>`
                SELECT t.id::text AS id FROM hq_task t
                WHERE t.app_id::text = ${comment.appId} AND t.mate_project_id IS NOT NULL AND (
                  t.id = (SELECT c.task_id FROM hq_change c WHERE c.app_id::text = ${comment.appId}
                    AND c.repo = ${comment.repo} AND c.number = ${comment.number})
                  OR (t.change_repo = ${comment.repo} AND t.change_number = ${comment.number}))
                ORDER BY t.seq DESC LIMIT 1`;
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
      // A task's change that no longer merges into `main` as it moved: HQ's word on the change,
      // said to its task once per head (`main:<head>`) — again only once its Mate delivered anew.
      yield* Effect.forkScoped(
        Stream.runForEach(gitHost.conflicts, (conflict) =>
          logged("a conflict with main not told")(
            Effect.gen(function* () {
              const [task] = yield* sql<{ readonly id: string }>`
                SELECT t.id::text AS id FROM hq_task t
                WHERE t.id::text = ${conflict.taskId} AND ${taskListens(sql, sql`t`)}`;
              if (task === undefined) return;
              yield* messageTask(task.id, {
                id: `main:${conflict.head}`,
                from: "review",
                author: HQ_AUTHOR,
                text: cleanTaskText(mainMovedWords(conflict)),
              });
            }),
          ),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(changes.taskChanges, (taskId) =>
          say(taskId, ({ mate, change, changeReady, changeMerged, pullRequest }) =>
            change === null
              ? undefined
              : // Merged in Mate (a pull request's merge is told by its own keeper).
                changeMerged && pullRequest === null
                ? { kind: "merged", mate: mate ?? "Mate", change }
                : // A draft is no change for review yet: the line keeps saying the Mate is on it.
                  !changeReady || changeMerged
                  ? undefined
                  : {
                      kind: "change",
                      mate: mate ?? "Mate",
                      link: change,
                      ...(pullRequest === null ? {} : { pullRequest }),
                    },
          ),
        ),
      );

      /**
       * The task is the Mate's: handed to it or taken by it — or, given back while its link was
       * down, waiting for no other Mate yet, as the Mate it was last handed to — or done by it
       * while its work is unsettled, with no change yet or its change still open: a review
       * comment on its change, or a person's message in its conversation, wakes it there. Once
       * its change was merged or closed, a word of it is passed by.
       */
      const owns = (projectId: string) => sql`(
        (mate_project_id = ${projectId} AND state IN ('assigned', 'working', 'waiting'))
        OR (state = 'queued' AND last_mate_project_id = ${projectId})
        OR (mate_project_id = ${projectId} AND ${doneUnsettled(sql, sql`hq_task`)}))`;

      /** The Mate's task, as it stands, where the Mate says it is its own. */
      const ownTask = (projectId: string, taskId: string) =>
        Effect.map(
          sql<{
            readonly state: string;
            readonly app_id: string;
            readonly question: string | null;
            readonly done_head: string | null;
          }>`
            SELECT state, app_id::text AS app_id, question, done_head FROM hq_task
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
            const [held] = yield* sql<{ readonly why: string | null; readonly queued: boolean }>`
              SELECT COALESCE(stop_reason, detail) AS why, state = 'queued' AS queued FROM hq_task
              WHERE id::text = ${word.taskId} AND (
                (state IN ('stopped', 'dropped')
                  AND (mate_project_id = ${projectId} OR last_mate_project_id = ${projectId}))
                OR (state IN ('assigned', 'working', 'waiting') AND mate_project_id <> ${projectId})
                OR (state = 'queued' AND last_mate_project_id IS NULL))`;
            // Back in line before HQ heard it take it (the budget was reached): dropped, so the
            // Mate takes it again when it is handed out again.
            if (held?.queued === true)
              return yield* tellMate(
                projectId,
                encodeDown({
                  type: "task-stop",
                  taskId: word.taskId,
                  reason: BUDGET_SPENT,
                  requeued: true,
                }),
              );
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

      /**
       * What the word says the task spent and worked, kept as the most its Mate said (a word told
       * again, or late, never lowers them), and what it added counted in this month's spend: what
       * it added, or none where it moved nothing.
       */
      const keepSpend = (projectId: string, word: MateTaskReport) =>
        leader.write(
          Effect.gen(function* () {
            const [kept] = yield* sql<{
              readonly app_id: string;
              readonly spent_usd: number | null;
              readonly worked_ms: number | null;
            }>`
              SELECT app_id::text AS app_id, spent_usd, worked_ms::float8 AS worked_ms FROM hq_task
              WHERE id = ${word.taskId}::uuid
                AND (mate_project_id = ${projectId} OR last_mate_project_id = ${projectId})
              FOR UPDATE`;
            if (kept === undefined) return undefined;
            const spent =
              word.spentUsd === undefined
                ? kept.spent_usd
                : Math.max(kept.spent_usd ?? 0, word.spentUsd);
            const worked =
              word.workedMs === undefined
                ? kept.worked_ms
                : Math.max(kept.worked_ms ?? 0, Math.round(word.workedMs));
            if (spent === kept.spent_usd && worked === kept.worked_ms) return undefined;
            yield* sql`
              UPDATE hq_task SET spent_usd = ${spent}, worked_ms = ${worked}
              WHERE id = ${word.taskId}::uuid`;
            const added = (spent ?? 0) - (kept.spent_usd ?? 0);
            if (added > 0)
              yield* sql`
                INSERT INTO hq_task_month_spend (month, app_id, spent_usd)
                VALUES (${sql.literal(THIS_MONTH)}, ${kept.app_id}::uuid, ${added})
                ON CONFLICT (month, app_id) DO UPDATE
                  SET spent_usd = hq_task_month_spend.spent_usd + EXCLUDED.spent_usd`;
            return added;
          }),
        );

      const report = (projectId: string, word: MateTaskReport) =>
        Effect.gen(function* () {
          // What it cost and how long it worked, as its Mate counts them: kept from any word of the
          // Mate that had it, even one past its end (its word that it stopped).
          if (
            (word.spentUsd !== undefined || word.workedMs !== undefined) &&
            isTaskId(word.taskId)
          ) {
            const added = yield* keepSpend(projectId, word);
            if (added !== undefined) {
              // Its Mate's row shows what it spent so far: told, as the Mate says it (once a
              // minute at most while it works).
              yield* structure.mateTouched(projectId);
              // At work, spending: the month's budget may be reached by it.
              if (added > 0 && (yield* overBudget)) yield* wake;
            }
          }
          const task = yield* ownTask(projectId, word.taskId);
          if (task === undefined) return yield* strayWord(projectId, word);
          // Done, it is not woken past the month's budget: the work it would do is stopped there.
          if (
            task.state === "done" &&
            (word.state === "working" || word.state === "waiting") &&
            (yield* overBudget)
          )
            return;
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
            // Back on it after it was done (a review, a person's message woke it): the line keeps
            // saying how it ended until it ends again.
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
            const ended = yield* leader.write(sql<{ readonly done_head: string | null }>`
              UPDATE hq_task SET state = ${word.state}, updated_at = now(),
                mate_project_id = ${projectId},
                detail = ${
                  // Done keeps the Mate's words where it left its work undelivered.
                  word.state === "failed" || word.state === "done"
                    ? word.detail?.trim() || null
                    : word.state === "stopped"
                      ? sql`COALESCE(${word.detail?.trim() || null}, stop_reason, ${STOPPED})`
                      : null
                },
                conversation_id = COALESCE(${word.conversationId ?? null}, conversation_id),
                stop_heard_at = ${word.state === "stopped" ? sql`now()` : sql`stop_heard_at`},
                stop_reason = ${word.state === "done" ? null : sql`stop_reason`},
                question = ${word.state === "done" ? null : sql`question`},
                done_head = ${
                  word.state === "done"
                    ? sql`(SELECT c.head FROM hq_change c WHERE c.app_id = hq_task.app_id
                        AND c.repo = hq_task.change_repo AND c.number = hq_task.change_number)`
                    : sql`done_head`
                }
              WHERE id::text = ${word.taskId} AND ${owns(projectId)}
              RETURNING done_head`);
            if (ended.length > 0 && word.state === "failed") yield* couldNotFinish(word.taskId);
            if (ended.length > 0 && word.state === "stopped") yield* stoppedSaid(word.taskId, true);
            if (ended.length > 0 && word.state === "done" && task.state !== "done") {
              // Its Mate's closing words (none from an older Mate), and the commit its change took
              // since it last ended: an ending after a follow-up says what it did this time.
              const words = cleanTaskText(word.answer ?? "").trim();
              const head = ended[0]?.done_head ?? null;
              const pushed = task.done_head !== null && head !== null && head !== task.done_head;
              yield* say(
                word.taskId,
                ({ mate, change, changeMerged, pullRequest, detail }) =>
                  // Its change merged already: the line keeps saying so.
                  changeMerged
                    ? {
                        kind: "merged",
                        mate: mate ?? "Mate",
                        change,
                        ...(pullRequest === null ? {} : { pullRequest }),
                      }
                    : {
                        kind: "done",
                        mate: mate ?? "Mate",
                        link: change,
                        ...(pullRequest === null ? {} : { pullRequest }),
                        ...(detail === null ? {} : { left: detail }),
                      },
                words === ""
                  ? undefined
                  : ({ mate, change, changeNumber, pullRequest }) => ({
                      mate: mate ?? "Mate",
                      words,
                      ...(pushed && change !== null && changeNumber !== null
                        ? {
                            pushed: {
                              number: changeNumber,
                              link: change,
                              ...(pullRequest === null ? {} : { pullRequest }),
                            },
                          }
                        : {}),
                    }),
              );
            }
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
        tell: (taskId, status) => say(taskId, status),
        link: (taskId) =>
          Effect.gen(function* () {
            const [task] = yield* sql<{
              readonly mate: string | null;
              readonly conversation_id: string | null;
            }>`
              SELECT COALESCE(mate_project_id, last_mate_project_id) AS mate, conversation_id
              FROM hq_task WHERE id::text = ${taskId}`;
            if (task?.mate == null) return null;
            return yield* linkTo(task.mate, task.conversation_id);
          }).pipe(Effect.orElseSucceed(() => null)),
        linkFrames: (projectId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Subscribed before its task is read: a task handed in between is in one or both.
              const live = yield* PubSub.subscribe(told);
              const handed = yield* sql<TaskRow>`
                SELECT ${sql.literal(TASK_COLUMNS)} FROM hq_task
                WHERE mate_project_id = ${projectId} AND state = 'assigned'`;
              const limits = handed.length === 0 ? DEFAULT_TASK_LIMITS : yield* limitsNow;
              const frames = yield* Effect.forEach(handed, (row) =>
                Effect.map(commitAuthorOf(row.app_id), (author) => taskFrame(row, limits, author)),
              );
              // On it: what was said of it, and whether people stopped it.
              const on = yield* sql<{ readonly id: string; readonly stop_reason: string | null }>`
                SELECT t.id::text AS id, t.stop_reason FROM hq_task t
                WHERE t.mate_project_id = ${projectId} AND t.state IN ('working', 'waiting')`;
              const said = yield* messagesOf(on.map((task) => task.id));
              // On none: the follow-up it owes on one it is done with, told again (it hears each
              // message once).
              // (A Core that does not lead leaves it to the one that does.)
              if (on.length === 0)
                yield* followUps(sql`project_id = ${projectId}`, true).pipe(
                  Effect.catchTags({ NotLeader: () => Effect.void }),
                );
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
                Stream.fromIterable([...frames.flatMap((frame) => frame ?? []), ...said, ...stops]),
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
