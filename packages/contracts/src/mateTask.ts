/**
 * A task from outside for an automated Mate: work that came from where a team keeps its work (a
 * GitHub issue first), not from a person typing to the Mate. HQ takes it in, queues it for the
 * application's automated Mates and hands each to one that is free; the Mate works it in a
 * conversation of its own and says how it went.
 *
 * @module mateTask
 */
import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MATE_TASK_TITLE_MAX = 256;
/** How much of the issue's text a task carries; the rest stays on GitHub, a link away. */
export const MATE_TASK_BODY_MAX = 16_000;

const SourceTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(MATE_TASK_TITLE_MAX));

/** A GitHub issue labelled for the application's automated Mates. */
export const GithubIssueSource = Schema.Struct({
  kind: Schema.Literal("github-issue"),
  /** `owner/name`. */
  repo: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
  title: SourceTitle,
  /** The GitHub login that opened the issue, or none known. */
  author: Schema.NullOr(TrimmedNonEmptyString),
});
export type GithubIssueSource = typeof GithubIssueSource.Type;

/** A Slack message that mentioned Mate in a channel mapped to the application: its thread. */
export const SlackThreadSource = Schema.Struct({
  kind: Schema.Literal("slack-thread"),
  /** The workspace's name, as people know it. */
  workspace: TrimmedNonEmptyString,
  /** The channel's name, without `#`. */
  channel: TrimmedNonEmptyString,
  /** The thread's permalink. */
  url: TrimmedNonEmptyString,
  /** The ask's first line. */
  title: SourceTitle,
  /** The person's display name, or none known. */
  author: Schema.NullOr(TrimmedNonEmptyString),
});
export type SlackThreadSource = typeof SlackThreadSource.Type;

/** A Discord `/mate` command in a channel mapped to the application: the thread the bot opened. */
export const DiscordThreadSource = Schema.Struct({
  kind: Schema.Literal("discord-thread"),
  /** The server's (guild's) name. */
  server: TrimmedNonEmptyString,
  /** The channel's name, without `#`. */
  channel: TrimmedNonEmptyString,
  /** The thread's link. */
  url: TrimmedNonEmptyString,
  title: SourceTitle,
  author: Schema.NullOr(TrimmedNonEmptyString),
});
export type DiscordThreadSource = typeof DiscordThreadSource.Type;

/** A call on one of the application's signed webhooks (Sentry, PagerDuty, a Jira rule…). */
export const WebhookSource = Schema.Struct({
  kind: Schema.Literal("webhook"),
  /** The webhook's name, as the application's settings name it. */
  name: TrimmedNonEmptyString,
  /** A link the caller gave to what it is about, or none. */
  url: Schema.NullOr(TrimmedNonEmptyString),
  title: SourceTitle,
  author: Schema.NullOr(TrimmedNonEmptyString),
});
export type WebhookSource = typeof WebhookSource.Type;

/** A schedule of the application's ("every Monday at 9:00 …"): one task each time it is due. */
export const ScheduleSource = Schema.Struct({
  kind: Schema.Literal("schedule"),
  /** The schedule's name. */
  name: TrimmedNonEmptyString,
  title: SourceTitle,
});
export type ScheduleSource = typeof ScheduleSource.Type;

/** Where a task came from, as its card draws it. */
export const MateTaskSource = Schema.Union([
  GithubIssueSource,
  SlackThreadSource,
  DiscordThreadSource,
  WebhookSource,
  ScheduleSource,
]);
export type MateTaskSource = typeof MateTaskSource.Type;

/** What a task may spend before its Mate stops it and says where it got to. */
export const MateTaskLimits = Schema.Struct({
  /** Minutes of the agent at work on it. */
  minutes: PositiveInt,
  /** US dollars of model use, as the provider reports it; none: no cost limit. */
  costUsd: Schema.NullOr(Schema.Number.check(Schema.isGreaterThan(0))),
});
export type MateTaskLimits = typeof MateTaskLimits.Type;

/**
 * The most one task's report may say it spent or worked: past any limit a person can set, so a
 * broken or hostile report cannot fill the organization's month or fail HQ's write.
 */
export const TASK_SPENT_MAX = 100_000;
export const TASK_WORKED_MAX = 100 * 24 * 60 * 60_000;

/**
 * Who a task's commits are by: the organization's GitHub app's bot (`<slug>[bot]`, its address
 * `<bot user id>+<slug>[bot]@users.noreply.github.com`), so GitHub shows them as the bot's.
 */
export const MateTaskCommitAuthor = Schema.Struct({
  name: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
});
export type MateTaskCommitAuthor = typeof MateTaskCommitAuthor.Type;

/** A task as HQ hands it to a Mate. */
export const MateTask = Schema.Struct({
  /** HQ's id of the task: the same task handed twice is one task. */
  id: TrimmedNonEmptyString,
  source: MateTaskSource,
  /** The ask's text (the issue's, the message's, the call's, the schedule's), cut to `MATE_TASK_BODY_MAX`. */
  body: Schema.String.check(Schema.isMaxLength(MATE_TASK_BODY_MAX)),
  /** What it may spend. */
  limits: MateTaskLimits,
  /**
   * Who its commits are by, where its application mirrors to GitHub through the organization's
   * app and HQ knows the app's bot; absent otherwise (a token's mirror, none, GitHub out of reach),
   * and from an older HQ: the Mate leaves its working copies' author as it is.
   */
  commitAuthor: Schema.optionalKey(MateTaskCommitAuthor),
});
export type MateTask = typeof MateTask.Type;

/**
 * How a task stands, as its Mate says: taken (`accepted`), worked on (`working`), waiting for a
 * person's answer (`waiting`, with its `question`), finished (`done`), not finished (`failed`),
 * stopped because people stopped it (`stopped`: the issue closed, the label removed, a `task-stop`)
 * — or not taken now (`declined`: it is busy, or its key has not come yet), which hands the task
 * back to wait for a free Mate and never counts as a try. A change the Mate opens while on a task is
 * the task's change: HQ links them, since a Mate works one task at a time.
 */
export const MateTaskStateKind = Schema.Literals([
  "accepted",
  "working",
  "waiting",
  "done",
  "failed",
  "stopped",
  "declined",
]);
export type MateTaskStateKind = typeof MateTaskStateKind.Type;

export const MateTaskReport = Schema.Struct({
  taskId: TrimmedNonEmptyString,
  state: MateTaskStateKind,
  /** The conversation the Mate works it in, once it has one. */
  conversationId: Schema.optionalKey(TrimmedNonEmptyString),
  /**
   * Why it failed or stopped, in words a person reads; done, where it left its work undelivered
   * (never a plain done then).
   */
  detail: Schema.optionalKey(Schema.String),
  /** What it asks a person, while `waiting`: posted where the task came from. */
  question: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MATE_TASK_BODY_MAX))),
  /**
   * What its agent said last in the run that ended it, once `done`: its answer or what it did,
   * posted where the task came from. Absent where it said nothing then, and from an older Mate.
   */
  answer: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MATE_TASK_BODY_MAX))),
  /** What its model use cost so far, in US dollars, as the Mate's ledger counts it. */
  spentUsd: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: TASK_SPENT_MAX })),
  ),
  /** How long its runs worked so far (never the wait between them), in milliseconds. */
  workedMs: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: TASK_WORKED_MAX })),
  ),
});
export type MateTaskReport = typeof MateTaskReport.Type;

/**
 * Something said about a task after its Mate took it — a comment on its issue, a reply in its
 * thread, a review comment on its change, an edit of the issue — told to its Mate, which hears it
 * in the task's own conversation. Only what a person allowed to steer it said (HQ's gate).
 */
export const MateTaskMessage = Schema.Struct({
  /** HQ's id of the message: told twice, heard once. */
  id: TrimmedNonEmptyString,
  from: Schema.Literals(["comment", "reply", "review", "edit"]),
  author: Schema.NullOr(TrimmedNonEmptyString),
  text: Schema.String.check(Schema.isMaxLength(MATE_TASK_BODY_MAX)),
});
export type MateTaskMessage = typeof MateTaskMessage.Type;

/**
 * Where a task came from, in people's words: "acme/tea-shop#12", "#support on Slack", "#dev on
 * Discord", "the Sentry webhook", "the Weekly upkeep schedule".
 */
export function mateTaskSourceLabel(source: MateTaskSource): string {
  switch (source.kind) {
    case "github-issue":
      return `${source.repo}#${String(source.number)}`;
    case "slack-thread":
      return `#${source.channel} on Slack`;
    case "discord-thread":
      return `#${source.channel} on Discord`;
    case "webhook":
      return `the ${source.name} webhook`;
    case "schedule":
      return `the ${source.name} schedule`;
  }
}

/** The way out to where a task came from, and the words on it; none for a schedule's. */
export function mateTaskSourceLink(
  source: MateTaskSource,
): { readonly url: string; readonly words: string } | null {
  switch (source.kind) {
    case "github-issue":
      return { url: source.url, words: "Open on GitHub" };
    case "slack-thread":
      return { url: source.url, words: "Open in Slack" };
    case "discord-thread":
      return { url: source.url, words: "Open in Discord" };
    case "webhook":
      return source.url === null ? null : { url: source.url, words: "Open" };
    case "schedule":
      return null;
  }
}

/** Who asked, where the source knows: an issue's author, a message's sender. */
export function mateTaskSourceAuthor(source: MateTaskSource): string | null {
  return source.kind === "schedule" ? null : source.author;
}

/**
 * The one conversation an automated Mate works every task in, each its own turn on a fresh agent
 * session: its person messages name their task (`taskId`), never the conversation.
 */
export const MATE_TASKS_CONVERSATION_ID = "tasks";

/**
 * What started the id of the conversation each task was worked in before a Mate worked them all in
 * one (the server's `taskConversationId`): those stay a task's own, as history.
 */
export const MATE_TASK_CONVERSATION_PREFIX = "task-";

/** Whether tasks are worked in the conversation: the Mate's one for them, or an older task's own. */
export function isMateTaskConversation(conversationId: string): boolean {
  return (
    conversationId === MATE_TASKS_CONVERSATION_ID ||
    conversationId.startsWith(MATE_TASK_CONVERSATION_PREFIX)
  );
}

/**
 * HQ's id of the task an older task's own conversation (`task-…`) is worked for, read back from
 * its id: the server named it by the task, every character a conversation id does not carry spelled out as
 * `.<hex>.`. `undefined` for any other conversation.
 */
export function mateTaskIdOfConversation(conversationId: string): string | undefined {
  if (!conversationId.startsWith(MATE_TASK_CONVERSATION_PREFIX)) return undefined;
  return conversationId
    .slice(MATE_TASK_CONVERSATION_PREFIX.length)
    .replace(/\.([0-9a-f]+)\./gu, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}
