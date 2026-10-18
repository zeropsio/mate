/**
 * Where tasks come from and how each source hears back. Every source (a GitHub issue, a Slack
 * thread, a Discord thread, a signed webhook, a schedule) does the same five things: takes a task
 * in once its gate passed (`TaskIntake.enqueue`), acknowledges it at once, keeps ONE status line it
 * edits as the task moves, carries follow-ups both ways (`TaskIntake.message`), and says how it
 * ended. A source registers its channel here; `mateTasks.ts` calls it as the task moves.
 *
 * @module taskSources
 */
import {
  MATE_TASK_BODY_MAX,
  MATE_TASK_TITLE_MAX,
  type MateTaskMessage,
  MateTaskSource,
  mateTaskSourceLabel,
  mateTaskSourceLink,
} from "@t3tools/contracts";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** What a source asks of HQ once a person it lets in asked for work. */
export interface TaskEnqueue {
  readonly appId: string;
  readonly source: MateTaskSource;
  /** The ask's text, as its author wrote it (cleaned by HQ before any Mate sees it). */
  readonly body: string;
  /**
   * The work item: one live task per key (`github:acme/tea-shop#12`, `slack:<team>/<channel>/<ts>`,
   * `discord:<thread id>`, `webhook:<id>/<dedupeKey>`, `schedule:<id>/<due ISO>`). A second ask on
   * a key with a live task is a message to it, never a second task.
   */
  readonly sourceKey: string;
  /** The delivery's own id: told twice, taken once. */
  readonly deliveryId: string;
  /** The Zerops user it was asked for, where the source maps one (the gate's answer). */
  readonly requestedBy: string | null;
}

export type TaskEnqueued =
  | { readonly kind: "queued"; readonly taskId: string; readonly position: number }
  | { readonly kind: "duplicate" }
  /** A live task already holds the key: the ask went to it as a message. */
  | { readonly kind: "told"; readonly taskId: string };

/** HQ could not take a task in now (it is not the leading HQ, or its database is away): ask again. */
export class TaskIntakeUnavailable extends Schema.TaggedError<TaskIntakeUnavailable>()(
  "TaskIntakeUnavailable",
  {},
) {}

/** HQ's door for sources: in, follow-ups, and stops. */
export class TaskIntake extends Context.Service<
  TaskIntake,
  {
    readonly enqueue: (input: TaskEnqueue) => Effect.Effect<TaskEnqueued, TaskIntakeUnavailable>;
    /** A follow-up on the key's live task (dropped, and false, when it has none). */
    readonly message: (sourceKey: string, message: MateTaskMessage) => Effect.Effect<boolean>;
    /** People stopped the key's live task (issue closed, label removed, thread deleted). */
    readonly stop: (sourceKey: string, reason: string) => Effect.Effect<void>;
  }
>()("@t3tools/hq/taskSources/TaskIntake") {}

/** A task as its source's channel addresses it. */
export interface TaskOnSource {
  readonly taskId: string;
  readonly appId: string;
  readonly source: MateTaskSource;
  readonly sourceKey: string;
  /** Where its status line lives, once `status` made it and answered where; absent before. */
  readonly statusRef?: string;
}

/** The one status line a source keeps for a task, edited as the task moves. */
export type TaskStatus =
  | { readonly kind: "queued"; readonly position: number }
  /** `link`: where its conversation is followed in Mate. */
  | { readonly kind: "picked"; readonly mate: string; readonly link?: string }
  | { readonly kind: "waiting"; readonly mate: string; readonly question: string }
  | {
      readonly kind: "change";
      readonly mate: string;
      readonly link: string;
      readonly pullRequest?: TaskPullRequest;
    }
  | {
      readonly kind: "done";
      readonly mate: string;
      readonly link: string | null;
      readonly pullRequest?: TaskPullRequest;
    }
  /**
   * Its change was merged: its pull request (on GitHub, or by Merge in Mate), or the change itself
   * in Mate where its repository mirrors through no app (`change`, its address).
   */
  | {
      readonly kind: "merged";
      readonly mate: string;
      readonly pullRequest?: TaskPullRequest;
      readonly change?: string | null;
    }
  | { readonly kind: "failed"; readonly mate: string | null; readonly why: string }
  | { readonly kind: "stopped"; readonly mate: string | null; readonly why: string };

/** The pull request a task's change is mirrored to on GitHub, as its status line names it. */
export interface TaskPullRequest {
  readonly number: number;
  readonly url: string;
}

/**
 * A Mate's own name in its application: its Zerops project is named `"<application> - <name>"`
 * (`client-runtime` `nameUnderApp`), and a status line, a pull request or a commit names it by
 * what follows; a name of any other shape is said whole.
 */
export const mateNameIn = (projectName: string, appName: string | null | undefined) => {
  const whole = projectName.trim();
  const prefix = `${appName?.trim() ?? ""} - `;
  if (appName == null || appName.trim() === "" || !whole.startsWith(prefix)) return whole;
  return whole.slice(prefix.length).trim() || whole;
};

/** How a source hears back about its tasks. Every call is best-effort: a failure never moves a task. */
export interface TaskSourceChannel {
  readonly kind: MateTaskSource["kind"];
  /** At once, on intake: a reaction on the ask, where the source has one. */
  readonly acknowledge: (task: TaskOnSource) => Effect.Effect<void>;
  /**
   * The one status line, made the first time and edited after: the call that makes it answers
   * where it lives (a comment's id, a message's ts), which HQ keeps as the task's `status_ref` and
   * hands back in `statusRef`.
   */
  readonly status: (task: TaskOnSource, status: TaskStatus) => Effect.Effect<string | void>;
  /**
   * Once, a day after a task began waiting for an answer: a new message on the source that asks
   * again (an edit tells nobody). Absent: HQ says the waiting status again instead.
   */
  readonly remind?: (task: TaskOnSource, question: string) => Effect.Effect<void>;
}

/** The registered channels, by source kind: each source's layer registers its own. */
export class TaskSourceChannels extends Context.Service<
  TaskSourceChannels,
  {
    readonly register: (channel: TaskSourceChannel) => Effect.Effect<void>;
    readonly of: (kind: MateTaskSource["kind"]) => Effect.Effect<TaskSourceChannel | undefined>;
  }
>()("@t3tools/hq/taskSources/TaskSourceChannels") {}

/** Zero-width and bidirectional-control characters: they hide or reorder what a person reads. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u061C]/gu;

/**
 * A person's text as a Mate may read it: no HTML comments (unseen on GitHub, read by an agent), no
 * zero-width or bidi characters, cut to `max`.
 */
export const cleanTaskText = (text: string, max = MATE_TASK_BODY_MAX) =>
  text
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
    .replace(INVISIBLE, "")
    .slice(0, max);

/** A person's name as a task carries it: trimmed and cleaned, or nobody where nothing is left. */
export const authorOf = (name: string | null | undefined): string | null =>
  cleanTaskText(name ?? "", MATE_TASK_TITLE_MAX).trim() || null;

/** A task's title, cleaned the same way, or `fallback` where nothing is left of it. */
export const cleanTaskTitle = (title: string, fallback: string) =>
  cleanTaskText(title, MATE_TASK_TITLE_MAX * 4)
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MATE_TASK_TITLE_MAX) || fallback;

const decodeSource = Schema.decodeUnknownOption(MateTaskSource);

/** A task's source as its row keeps it (`hq_task.source`), read; none where it does not decode. */
export const sourceOfRow = (raw: unknown): MateTaskSource | undefined =>
  Option.getOrUndefined(decodeSource(raw));

/** The task an automated Mate is on, as its menu row names it. */
export const navigationTaskOf = (task: {
  readonly id: string;
  readonly source: MateTaskSource;
  readonly waiting: boolean;
  /** Its change's pull request on GitHub, where it has one. */
  readonly pullRequest?: HqNavigationMateTask["pullRequest"] | undefined;
  /** How it ended, for a Mate's most recent task while none is live. */
  readonly ended?: HqNavigationMateTask["ended"] | undefined;
}): HqNavigationMateTask => ({
  id: task.id,
  ...(task.source.kind === "github-issue"
    ? { repo: task.source.repo, number: task.source.number }
    : {}),
  title: task.source.title,
  url: mateTaskSourceLink(task.source)?.url ?? null,
  label: mateTaskSourceLabel(task.source),
  ...(task.waiting ? { waiting: true as const } : {}),
  ...(task.pullRequest === undefined ? {} : { pullRequest: task.pullRequest }),
  ...(task.ended === undefined ? {} : { ended: task.ended }),
});

/** A task's source as its row keeps it: JSON, for `::jsonb`. */
export const encodeSource = Schema.encodeSync(Schema.fromJsonString(MateTaskSource));
