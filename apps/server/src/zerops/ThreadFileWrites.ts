/**
 * What a thread's agent wrote, from the thread's own record: the stored
 * payloads of its calls, read by `fileWrites.ts`. Nothing is read from disk,
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
 * - to a caller who may read the thread (`orchestration:read`, as
 *   `subscribeThread`), at most {@link FILE_WRITES_RESPONSE_MAX_CHARS} of
 *   text in one answer.
 *
 * @module ThreadFileWrites
 */
import {
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
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { MateEngine, type MateEngineService } from "../engine/MateEngine.ts";
import { readFileWritePaths, readFileWrites } from "./fileWrites.ts";

/** The most text one answer carries: past it, what is left is cut and said to be. */
export const FILE_WRITES_RESPONSE_MAX_CHARS = 1024 * 1024;

/** A completed write of the thread, as stored: its payload, and when the server stamped it. */
export interface CompletedWrite {
  readonly payload: unknown;
  readonly completedAt: string;
}

/** What the service reads of the thread: its completed writes of a path, its calls' payloads. */
export interface ThreadFileWritesStore {
  /**
   * The `tool.completed` rows of the thread that may name this path, oldest
   * first: a cheap filter — the service reads each one itself.
   */
  readonly completedWrites: (
    threadId: ThreadId,
    path: string,
  ) => Effect.Effect<ReadonlyArray<CompletedWrite>>;
  /** Each stored lifecycle row of these calls of the thread, newest first. */
  readonly callPayloads: (
    threadId: ThreadId,
    callIds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<{ readonly callId: string; readonly payload: unknown }>>;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether a stored completion is a call that wrote: completed, as the
 * server's own row says — never a failed, declined or never-returned one
 * (closed by its turn's end).
 */
function wrote(payload: unknown): boolean {
  const record = asRecord(payload);
  return record !== null && record.status === "completed" && record.unreturned !== true;
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
      const rows = yield* store.callPayloads(input.threadId, asked);
      const room = { left: FILE_WRITES_RESPONSE_MAX_CHARS };
      const calls = asked.flatMap((toolCallId) => {
        if (room.left <= 0) return [];
        for (const row of rows) {
          if (row.callId !== toolCallId) continue;
          const writes = readFileWrites(asRecord(row.payload)?.data);
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
      const newest = (yield* store.completedWrites(input.threadId, path)).findLast(
        (row) =>
          wrote(row.payload) && readFileWritePaths(asRecord(row.payload)?.data).includes(path),
      );
      if (newest === undefined) return yield* new ThreadFileWritesError({ reason: "not_written" });
      const ofPath = readFileWrites(asRecord(newest.payload)?.data).filter(
        (write) => write.path === path,
      );
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

/** The store over the thread's own projection rows. */
export const makeSqlStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A store that cannot answer answers nothing: nothing is shown.
  const orNothing = <A>(fallback: A) => Effect.orElseSucceed(() => fallback);

  const parsed = (json: string): unknown => {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  // Only the rows whose stored text holds the path, as JSON writes it: a scan
  // of the bytes, never a parse of the thread's every payload.
  const completedWrites: ThreadFileWritesStore["completedWrites"] = (threadId, path) =>
    sql<{ readonly payload: string; readonly completedAt: string }>`
      SELECT payload_json AS "payload", created_at AS "completedAt"
      FROM projection_thread_activities
      WHERE thread_id = ${threadId}
        AND kind = 'tool.completed'
        AND instr(payload_json, ${JSON.stringify(path).slice(1, -1)}) > 0
      ORDER BY sequence ASC, created_at ASC, activity_id ASC
    `.pipe(
      Effect.map((rows) =>
        rows.map((row) => ({ payload: parsed(row.payload), completedAt: row.completedAt })),
      ),
      orNothing<ReadonlyArray<CompletedWrite>>([]),
    );

  const callPayloads: ThreadFileWritesStore["callPayloads"] = (threadId, callIds) =>
    callIds.length === 0
      ? Effect.succeed([])
      : sql<{ readonly callId: string; readonly payload: string }>`
          SELECT call_id AS "callId", payload_json AS "payload"
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
            AND ${sql.in("call_id", callIds)}
            AND kind IN ('tool.started', 'tool.updated', 'tool.completed')
          ORDER BY sequence DESC, created_at DESC, activity_id DESC
        `.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({ callId: row.callId, payload: parsed(row.payload) })),
          ),
          orNothing<ReadonlyArray<{ readonly callId: string; readonly payload: unknown }>>([]),
        );

  return { completedWrites, callPayloads } satisfies ThreadFileWritesStore;
});

/**
 * The store over the Mate engine's record, while it owns the conversation: a conversation's
 * calls' own records, kept beside their items (`MateEngine.callData`). The thread is the
 * conversation, a call its item.
 */
export const makeEngineStore = (engine: MateEngineService): ThreadFileWritesStore => ({
  completedWrites: (threadId, path) =>
    Effect.map(engine.callData(ConversationId.make(threadId), { naming: path }), (rows) =>
      rows.map((row) => ({
        // The call's own end, as V1's row says it: only a call that completed wrote.
        payload: { status: row.state === "done" ? "completed" : row.state, data: row.data },
        completedAt: DateTime.formatIso(DateTime.makeUnsafe(row.at)),
      })),
    ),
  callPayloads: (threadId, callIds) =>
    Effect.map(engine.callData(ConversationId.make(threadId), { itemIds: callIds }), (rows) =>
      rows.toReversed().map((row) => ({ callId: row.itemId, payload: { data: row.data } })),
    ),
});

/** What the thread's agent wrote: from the engine's record while it owns the conversation. */
export const layer = Layer.effect(
  ThreadFileWrites,
  Effect.gen(function* () {
    const engine = yield* MateEngine;
    return make(engine.live ? makeEngineStore(engine) : yield* makeSqlStore);
  }),
);
