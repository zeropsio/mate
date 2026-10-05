/**
 * What a thread's agent wrote, read back from its own tool events.
 *
 * - `threads.fileWrites` — a written or edited file's row opens onto what was
 *   written: a new file's content, an edit's change. Drawn from the call's own
 *   payload as the server stored it (the client's copy keeps none of it).
 * - `threads.readWrittenFile` — a file this thread's agent wrote outside the
 *   workspace, read-only, and only one it wrote: the security model is the
 *   2026-10-06 entry in `docs/internals/zerops/design-decisions.md`.
 *
 * @module threadFileWrites
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * How a write is drawn: `content` is a file's text as it was written (a new
 * file, a whole-file write); `diff` is a change, a line each, led by `+`, `-`,
 * ` ` (context) or `@@` (a gap between the parts it changed).
 */
export const FileWriteFormat = Schema.Literals(["content", "diff"]);
export type FileWriteFormat = typeof FileWriteFormat.Type;

/** One file one call wrote: `write` made or replaced it whole, `edit` changed part of it. */
export const FileWrite = Schema.Struct({
  /** As the call named it: absolute, or relative to the agent's directory. */
  path: TrimmedNonEmptyString,
  kind: Schema.Literals(["write", "edit"]),
  format: FileWriteFormat,
  text: Schema.String,
  /** The text was cut at the server's cap: the file itself holds the rest. */
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

/** The longest path a written file is asked by. */
export const THREAD_WRITTEN_FILE_PATH_MAX_LENGTH = 4096;

export const ThreadWrittenFileInput = Schema.Struct({
  threadId: ThreadId,
  /** Absolute, exactly as one of the thread's own writes named it. */
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_WRITTEN_FILE_PATH_MAX_LENGTH)),
});
export type ThreadWrittenFileInput = typeof ThreadWrittenFileInput.Type;

export const ThreadWrittenFileResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  contents: Schema.String,
  byteLength: NonNegativeInt,
});
export type ThreadWrittenFileResult = typeof ThreadWrittenFileResult.Type;

/**
 * Why a written file was not served. Each is a refusal, never a partial read:
 * - `not_absolute` — the path is not absolute;
 * - `not_written` — no completed write or edit of this thread named this exact path;
 * - `link_after_thread` — a symbolic link on its way was made, or changed, after the thread began;
 * - `not_file` — it is gone, or not a regular file;
 * - `binary` — it is not UTF-8 text;
 * - `too_large` — it is past the cap;
 * - `unavailable` — the thread is gone, or this server cannot read it.
 */
export const ThreadWrittenFileRefusal = Schema.Literals([
  "not_absolute",
  "not_written",
  "link_after_thread",
  "not_file",
  "binary",
  "too_large",
  "unavailable",
]);
export type ThreadWrittenFileRefusal = typeof ThreadWrittenFileRefusal.Type;

export class ThreadFileWritesError extends Schema.TaggedError<ThreadFileWritesError>()(
  "ThreadFileWritesError",
  { reason: ThreadWrittenFileRefusal, detail: Schema.optional(Schema.String) },
) {
  override get message(): string {
    return `The written file was not served: ${this.reason}${this.detail ? ` (${this.detail})` : ""}`;
  }
}
