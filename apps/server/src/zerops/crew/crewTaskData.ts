/**
 * crewTaskData — the shapes the engine keeps in a task's JSON columns
 * (`crew_assignment.*_json`), decoded where they are read.
 *
 * | Column         | Shape            | Holds                                                   |
 * |----------------|------------------|---------------------------------------------------------|
 * | `card_json`    | {@link TaskCard} | what the task asks: its brief, Done when, the fan-out note |
 * | `pending_json` | {@link TaskPending} | the card text a queued task sends when it starts     |
 * | `report_json`  | {@link TaskReport} | the crewmate's last `crew_report`                     |
 * | `check_json`   | `CrewCheck`      | the last check on the tree that would land              |
 * | `review_json`  | `CrewReview`     | the last review (phase C)                               |
 * | `waiting_json` | {@link TaskWait} | why it is not moving: rework, park, or your tree's paths |
 *
 * A column that does not decode reads as absent: a row written by a later
 * build never stops a snapshot.
 *
 * @module crewTaskData
 */
import { CrewCheck, CrewReview } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const TaskCard = Schema.Struct({
  brief: Schema.String,
  doneWhen: Schema.String,
  /** The fan-out line naming the other crewmates the same message went to. */
  note: Schema.NullOr(Schema.String),
});
export type TaskCard = typeof TaskCard.Type;

export const TaskPending = Schema.Struct({ card: Schema.String });
export type TaskPending = typeof TaskPending.Type;

export const TaskReport = Schema.Struct({
  status: Schema.Literals(["done", "blocked", "progress"]),
  summary: Schema.String,
  question: Schema.NullOr(Schema.String),
});
export type TaskReport = typeof TaskReport.Type;

/**
 * Why a task waits. `reason` is a code the attention rows read (`conflict`,
 * `check-failed`) or the park's own words; `paths` are the conflicting files
 * or your tree's files a landing waits on.
 */
export const TaskWait = Schema.Struct({
  reason: Schema.NullOr(Schema.String),
  paths: Schema.Array(Schema.String),
});
export type TaskWait = typeof TaskWait.Type;

/** A merge-in stopped on conflicts: the task went back to its crewmate naming the files. */
export const WAIT_CONFLICT = "conflict";
/** The check failed on the tree that would land. */
export const WAIT_CHECK_FAILED = "check-failed";

const read =
  <A>(decode: (value: unknown) => Option.Option<A>) =>
  (value: unknown): A | null =>
    value === null || value === undefined ? null : Option.getOrNull(decode(value));

export const readTaskCard = read(Schema.decodeUnknownOption(TaskCard));
export const readTaskPending = read(Schema.decodeUnknownOption(TaskPending));
export const readTaskReport = read(Schema.decodeUnknownOption(TaskReport));
export const readTaskWait = read(Schema.decodeUnknownOption(TaskWait));
export const readTaskCheck = read(Schema.decodeUnknownOption(CrewCheck));
export const readTaskReview = read(Schema.decodeUnknownOption(CrewReview));
