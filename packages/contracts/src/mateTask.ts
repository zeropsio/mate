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

/** Where a task came from: the issue it brings, as its card draws it. */
export const MateTaskSource = Schema.Struct({
  kind: Schema.Literal("github-issue"),
  /** `owner/name`. */
  repo: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(MATE_TASK_TITLE_MAX)),
  /** The GitHub login that opened the issue, or none known. */
  author: Schema.NullOr(TrimmedNonEmptyString),
});
export type MateTaskSource = typeof MateTaskSource.Type;

/** A task as HQ hands it to a Mate. */
export const MateTask = Schema.Struct({
  /** HQ's id of the task: the same task handed twice is one task. */
  id: TrimmedNonEmptyString,
  source: MateTaskSource,
  /** The issue's text, cut to `MATE_TASK_BODY_MAX`. */
  body: Schema.String.check(Schema.isMaxLength(MATE_TASK_BODY_MAX)),
});
export type MateTask = typeof MateTask.Type;

/**
 * How a task stands, as its Mate says: taken (`accepted`), worked on (`working`), finished
 * (`done`) or not (`failed`). A change the Mate opens while on a task is the task's change: HQ
 * links them, since a Mate works one task at a time.
 */
export const MateTaskStateKind = Schema.Literals(["accepted", "working", "done", "failed"]);
export type MateTaskStateKind = typeof MateTaskStateKind.Type;

export const MateTaskReport = Schema.Struct({
  taskId: TrimmedNonEmptyString,
  state: MateTaskStateKind,
  /** The conversation the Mate works it in, once it has one. */
  conversationId: Schema.optionalKey(TrimmedNonEmptyString),
  /** Why it failed, in words a person reads. */
  detail: Schema.optionalKey(Schema.String),
});
export type MateTaskReport = typeof MateTaskReport.Type;
