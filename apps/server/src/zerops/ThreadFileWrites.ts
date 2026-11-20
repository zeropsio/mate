/**
 * What a thread's agent wrote, from the thread's own record: the stored
 * records of its calls (`CallRecord`), read by `fileWrites.ts`. Nothing is read from disk,
 * and nothing the agent only read or found in a file is sent — a reader sees
 * exactly what the agent wrote in its calls. A disk read could reveal adjacent
 * secrets or content changed since the call; only recorded completed writes are
 * served to thread readers:
 *
 * - `fileWrites` — a write's or an edit's row opens onto what its call wrote;
 * - `writtenFile` — the Files tab's view of a file written outside the
 *   workspace: what the thread's newest completed write of that exact,
 *   untrimmed path wrote there, and when the server stamped it. A failed,
 *   declined or never-returned call wrote nothing;
 * - to a caller who may read the thread (`orchestration:read`), at most
 *   {@link FILE_WRITES_RESPONSE_MAX_CHARS} of
 *   text in one answer.
 *
 * @module ThreadFileWrites
 */
import {
  type CallRecord,
  ConversationId,
  type FileWrite,
  ThreadFileWritesError,
  type ThreadFileWritesInput,
  type ThreadFileWritesResult,
  type ThreadId,
  type ThreadWrittenFileInput,
  type ThreadWrittenFileResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MateEngine, type MateEngineService } from "../engine/MateEngine.ts";
import { readFileWritePaths, readFileWrites } from "./fileWrites.ts";

/** The most text one answer carries: past it, what is left is cut and said to be. */
const FILE_WRITES_RESPONSE_MAX_CHARS = 1024 * 1024;

/** A stored write of the thread: how its call ended, what it wrote, when the server stamped it. */
export interface CompletedWrite {
  /** The call's own end (`done`, `failed`, `declined`, `unreturned`, …). */
  readonly state: string;
  readonly record: CallRecord;
  readonly completedAt: string;
}

/** What the service reads of the thread: its completed writes of a path, its calls' records. */
interface ThreadFileWritesStore {
  /**
   * The stored writes of the thread that may name this path, oldest first: a
   * cheap filter — the service reads each one itself.
   */
  readonly completedWrites: (
    threadId: ThreadId,
    path: string,
  ) => Effect.Effect<ReadonlyArray<CompletedWrite>>;
  /** Each stored record of these calls of the thread, newest first. */
  readonly callRecords: (
    threadId: ThreadId,
    callIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<{ readonly callId: string; readonly record: CallRecord }>>;
}

export class ThreadFileWrites extends Context.Service<
  ThreadFileWrites,
  {
    readonly fileWrites: (input: ThreadFileWritesInput) => Effect.Effect<ThreadFileWritesResult>;
    readonly writtenFile: (
      input: ThreadWrittenFileInput,
    ) => Effect.Effect<ThreadWrittenFileResult, ThreadFileWritesError>;
  }
>()("t3/zerops/ThreadFileWrites") {}

/**
 * The record of a stored write whose call is done, as its own end says —
 * never a failed, declined or never-returned one (closed by its turn's end).
 */
function writtenRecord({ state, record }: CompletedWrite): CallRecord | null {
  return state === "done" ? record : null;
}

/** Writes, the text of their changes cut once the answer holds `room` characters. */
function within(writes: ReadonlyArray<FileWrite>, room: { left: number }): FileWrite[] {
  const kept: FileWrite[] = [];
  for (const write of writes) {
    if (room.left <= 0) {
      if (kept.length > 0) kept[kept.length - 1] = { ...kept[kept.length - 1]!, truncated: true };
      break;
    }
    const changes = [];
    let truncated = write.truncated;
    for (const change of write.changes) {
      if (change.text.length <= room.left) {
        changes.push(change);
        room.left -= change.text.length;
      } else {
        changes.push({ ...change, text: change.text.slice(0, room.left) });
        room.left = 0;
        truncated = true;
        break;
      }
    }
    kept.push({ ...write, changes, truncated });
  }
  return kept;
}

export const make = (store: ThreadFileWritesStore): ThreadFileWrites["Service"] => {
  const fileWrites: ThreadFileWrites["Service"]["fileWrites"] = (input) =>
    Effect.gen(function* () {
      const asked = [...new Set(input.toolCallIds)];
      const rows = yield* store.callRecords(input.threadId, asked);
      const room = { left: FILE_WRITES_RESPONSE_MAX_CHARS };
      const calls = asked.flatMap((toolCallId) => {
        if (room.left <= 0) return [];
        for (const row of rows) {
          if (row.callId !== toolCallId) continue;
          const writes = readFileWrites(row.record);
          if (writes.length > 0) return [{ toolCallId, writes: within(writes, room) }];
        }
        return [];
      });
      return { calls };
    });

  const writtenFile: ThreadFileWrites["Service"]["writtenFile"] = (input) =>
    Effect.gen(function* () {
      const path = input.path;
      if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(path)) {
        return yield* new ThreadFileWritesError({ reason: "not_absolute" });
      }
      // The path exactly as a completed write named it — untrimmed, in the
      // form it was named — and the newest such write.
      const newest = (yield* store.completedWrites(input.threadId, path))
        .flatMap((row) => {
          const record = writtenRecord(row);
          return record !== null && readFileWritePaths(record).includes(path)
            ? [{ record, completedAt: row.completedAt }]
            : [];
        })
        .at(-1);
      if (newest === undefined) return yield* new ThreadFileWritesError({ reason: "not_written" });
      const ofPath = readFileWrites(newest.record).filter((write) => write.path === path);
      const [first] = ofPath;
      const write: FileWrite = {
        path,
        kind: first?.kind ?? "write",
        changes: ofPath.flatMap((each) => each.changes),
        truncated: ofPath.some((each) => each.truncated),
      };
      return { write, writtenAt: newest.completedAt };
    });

  return ThreadFileWrites.of({ fileWrites, writtenFile });
};

/**
 * The store over the Mate engine's record: a conversation's
 * calls' own records, kept beside their items (`MateEngine.callData`). The thread is the
 * conversation, a call its item.
 */
export const makeEngineStore = (engine: MateEngineService): ThreadFileWritesStore => ({
  completedWrites: (threadId, path) =>
    Effect.map(engine.callData(ConversationId.make(threadId), { naming: path }), (rows) =>
      rows.map((row) => ({
        state: row.state,
        record: row.data,
        completedAt: DateTime.formatIso(DateTime.makeUnsafe(row.at)),
      })),
    ),
  callRecords: (threadId, callIds) =>
    Effect.map(engine.callData(ConversationId.make(threadId), { itemIds: callIds }), (rows) =>
      rows.toReversed().map((row) => ({ callId: row.itemId, record: row.data })),
    ),
});

/** What the thread's agent wrote: from the engine's record. */
export const layer = Layer.effect(
  ThreadFileWrites,
  Effect.gen(function* () {
    return make(makeEngineStore(yield* MateEngine));
  }),
);
