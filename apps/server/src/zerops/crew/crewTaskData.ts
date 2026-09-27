/**
 * crewTaskData — the shapes the engine keeps in a task's JSON columns
 * (`crew_assignment.*_json`), decoded where they are read.
 *
 * | Column         | Shape            | Holds                                                   |
 * |----------------|------------------|---------------------------------------------------------|
 * | `card_json`    | {@link TaskCard} | what the task asks: its brief, Done when, the fan-out note |
 * | `report_json`  | {@link TaskReport} | the crewmate's last `crew_report`                     |
 * | `check_json`   | `CrewCheck`      | the last check on the tree that would land              |
 * | `review_json`  | `CrewReview`     | the last review (phase C)                               |
 * | `waiting_json` | {@link TaskWait} | why it is not moving: rework, park, or your tree's files |
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

export const TaskReport = Schema.Struct({
  status: Schema.Literals(["done", "blocked", "progress"]),
  summary: Schema.String,
  question: Schema.NullOr(Schema.String),
});
export type TaskReport = typeof TaskReport.Type;

/**
 * Why a task is not moving: its crewmate resolves a merge-in's conflicts,
 * fixes the check or takes a review's note (`rework`), a landing waits on
 * files in your tree, or the engine stopped it for triage (`parked`).
 * `reason` is the board's words after "Rework:" or "Stopped:"; `paths` are the
 * conflicting files or your tree's.
 */
export const TaskWait = Schema.Struct({
  on: Schema.Literals(["conflict", "check-failed", "review", "your-tree", "triage"]),
  reason: Schema.NullOr(Schema.String),
  paths: Schema.Array(Schema.String),
});
export type TaskWait = typeof TaskWait.Type;

const read =
  <A>(decode: (value: unknown) => Option.Option<A>) =>
  (value: unknown): A | null =>
    value === null || value === undefined ? null : Option.getOrNull(decode(value));

export const readTaskCard = read(Schema.decodeUnknownOption(TaskCard));
export const readTaskReport = read(Schema.decodeUnknownOption(TaskReport));
export const readTaskWait = read(Schema.decodeUnknownOption(TaskWait));
export const readTaskCheck = read(Schema.decodeUnknownOption(CrewCheck));
export const readTaskReview = read(Schema.decodeUnknownOption(CrewReview));
