/**
 * Where tasks come from and how each source hears back. Every source (a GitHub issue, a Slack
 * thread, a Discord thread, a signed webhook, a schedule) does the same five things: takes a task
 * in once its gate passed (`TaskIntake.enqueue`), acknowledges it at once, keeps ONE status line it
 * edits as the task moves, carries follow-ups both ways (`TaskIntake.message`), and says how it
 * ended. A source registers its channel here; `mateTasks.ts` calls it as the task moves.
 *
 * @module taskSources
 */
import type { MateTaskMessage, MateTaskSource } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

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

/** HQ's door for sources: in, follow-ups, and stops. */
export class TaskIntake extends Context.Service<
  TaskIntake,
  {
    readonly enqueue: (input: TaskEnqueue) => Effect.Effect<TaskEnqueued>;
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
}

/** The one status line a source keeps for a task, edited as the task moves. */
export type TaskStatus =
  | { readonly kind: "queued"; readonly position: number }
  | { readonly kind: "picked"; readonly mate: string }
  | { readonly kind: "waiting"; readonly mate: string; readonly question: string }
  | { readonly kind: "change"; readonly mate: string; readonly link: string }
  | { readonly kind: "done"; readonly mate: string; readonly link: string | null }
  | { readonly kind: "failed"; readonly mate: string | null; readonly why: string }
  | { readonly kind: "stopped"; readonly mate: string | null; readonly why: string };

/** How a source hears back about its tasks. Every call is best-effort: a failure never moves a task. */
export interface TaskSourceChannel {
  readonly kind: MateTaskSource["kind"];
  /** At once, on intake: a reaction on the ask, where the source has one. */
  readonly acknowledge: (task: TaskOnSource) => Effect.Effect<void>;
  /** The one status line, made the first time and edited after. */
  readonly status: (task: TaskOnSource, status: TaskStatus) => Effect.Effect<void>;
}

/** The registered channels, by source kind: each source's layer registers its own. */
export class TaskSourceChannels extends Context.Service<
  TaskSourceChannels,
  {
    readonly register: (channel: TaskSourceChannel) => Effect.Effect<void>;
    readonly of: (kind: MateTaskSource["kind"]) => Effect.Effect<TaskSourceChannel | undefined>;
  }
>()("@t3tools/hq/taskSources/TaskSourceChannels") {}
