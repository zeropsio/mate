/**
 * What a thread's agent wrote, from the thread's own record — never from
 * disk, and never what the agent only read or found in a file.
 *
 * - `threads.fileWrites` — a written or edited file's row opens onto what the
 *   call wrote: a write's content, an edit's new text. Drawn from the call's
 *   own payload as the server stored it (the client's copy keeps none of it).
 * - `threads.writtenFile` — the Files tab's read-only view of a file the
 *   thread's agent wrote outside the workspace: the newest completed write of
 *   that exact path, as it wrote it. A thread reader gets only the call's recorded
 *   write payload; an arbitrary disk read could reveal adjacent secrets or later content
 *   the agent never wrote.
 *
 * @module threadFileWrites
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** The longest path a written file is asked by. */
export const THREAD_WRITTEN_FILE_PATH_MAX_LENGTH = 4096;

/**
 * A path exactly as the call named it, never trimmed: `/a.txt ` is another
 * file than `/a.txt`, and only the one the agent named is answered.
 */
const RawPath = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(THREAD_WRITTEN_FILE_PATH_MAX_LENGTH),
);

/**
 * One change a call made, as the agent wrote it: the text it wrote there,
 * and how many lines it removed — counted, never shown.
 */
export const FileWriteChange = Schema.Struct({
  text: Schema.String,
  removedLines: NonNegativeInt,
});
export type FileWriteChange = typeof FileWriteChange.Type;

/**
 * One file one call wrote: `write` made or replaced it whole (one change, its
 * content), `edit` changed parts of it (a change each: the agent's new text,
 * never the old, nor the lines around it).
 */
export const FileWrite = Schema.Struct({
  /** As the call named it: absolute, or relative to the agent's directory. */
  path: RawPath,
  kind: Schema.Literals(["write", "edit"]),
  changes: Schema.Array(FileWriteChange),
  /** What it wrote was cut at the server's cap. */
  truncated: Schema.Boolean,
});
export type FileWrite = typeof FileWrite.Type;

/** At most this many calls in one ask: a step of edits one after another is a handful. */
export const THREAD_FILE_WRITES_MAX_CALLS = 64;

export const ThreadFileWritesInput = Schema.Struct({
  threadId: ThreadId,
  toolCallIds: Schema.Array(TrimmedNonEmptyString).check(
    Schema.isMaxLength(THREAD_FILE_WRITES_MAX_CALLS),
  ),
});
export type ThreadFileWritesInput = typeof ThreadFileWritesInput.Type;

export const ThreadFileWritesResult = Schema.Struct({
  /** Each asked call that wrote, in the order asked; a call that wrote nothing is absent. */
  calls: Schema.Array(
    Schema.Struct({
      toolCallId: TrimmedNonEmptyString,
      writes: Schema.Array(FileWrite),
    }),
  ),
});
export type ThreadFileWritesResult = typeof ThreadFileWritesResult.Type;

export const ThreadWrittenFileInput = Schema.Struct({
  threadId: ThreadId,
  /** Absolute, exactly as one of the thread's own writes named it. */
  path: RawPath,
});
export type ThreadWrittenFileInput = typeof ThreadWrittenFileInput.Type;

export const ThreadWrittenFileResult = Schema.Struct({
  /** What the thread's newest completed write of the path wrote there. */
  write: FileWrite,
  /** When that call completed, as the server stamped it. */
  writtenAt: IsoDateTime,
});
export type ThreadWrittenFileResult = typeof ThreadWrittenFileResult.Type;

/**
 * Why no written file is shown:
 * - `not_absolute` — the path is not absolute;
 * - `not_written` — no completed write or edit of this thread named this exact path;
 * - `unavailable` — this server cannot answer now.
 */
export const ThreadWrittenFileRefusal = Schema.Literals([
  "not_absolute",
  "not_written",
  "unavailable",
]);
export type ThreadWrittenFileRefusal = typeof ThreadWrittenFileRefusal.Type;

export class ThreadFileWritesError extends Schema.TaggedError<ThreadFileWritesError>()(
  "ThreadFileWritesError",
  { reason: ThreadWrittenFileRefusal, detail: Schema.optional(Schema.String) },
) {
  override get message(): string {
    return `No written file is shown: ${this.reason}${this.detail ? ` (${this.detail})` : ""}`;
  }
}
