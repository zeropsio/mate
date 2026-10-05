// @effect-diagnostics nodeBuiltinImport:off
/**
 * What a thread's agent wrote, read back from the thread's own tool events.
 *
 * - `fileWrites` — a write's or an edit's row opens onto what it wrote: the
 *   call's payload as stored (the client's copy keeps none of it), read by
 *   `fileWrites.ts` for every driver that sends one.
 * - `readWrittenFile` — a file the thread's agent wrote outside the
 *   workspace, served read-only. The security model (design-decisions.md,
 *   2026-10-06):
 *   - the path is absolute and, normalized, exactly one a completed write or
 *     edit of THIS thread named (a failed or declined call wrote nothing);
 *   - it is resolved a part at a time, and every symbolic link met on the way
 *     must be older than the thread: one made or changed since could be the
 *     agent's, pointing the path at a file it never wrote;
 *   - the file is opened without following a last link, and must be the very
 *     file the walk found (same device and inode), so a swap between the walk
 *     and the open is refused;
 *   - it has one name (no hard link to another file's content) and was last
 *     written after the thread began;
 *   - a regular file of UTF-8 text with no NUL byte, at most
 *     {@link WRITTEN_FILE_MAX_BYTES}: past it, refused, never cut;
 *   - to a caller who may read the thread (`orchestration:read`, as
 *     `subscribeThread`).
 *
 * @module ThreadFileWrites
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  ThreadFileWritesError,
  type ThreadFileWritesInput,
  type ThreadFileWritesResult,
  type ThreadId,
  type ThreadWrittenFileInput,
  type ThreadWrittenFileRefusal,
  type ThreadWrittenFileResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { readFileWritePaths, readFileWrites } from "./fileWrites.ts";

/** The largest written file served: past it, refused whole. */
export const WRITTEN_FILE_MAX_BYTES = 1024 * 1024;

/** How many links one path may pass through, as the kernel allows. */
const MAX_LINK_HOPS = 40;

/** What the service reads of the thread: its start, its completed writes, its calls' payloads. */
export interface ThreadFileWritesStore {
  /** When the thread began; none when it is unknown or deleted. */
  readonly threadStartedAt: (threadId: ThreadId) => Effect.Effect<Option.Option<string>>;
  /** The stored payload of each `tool.completed` row of the thread that changed a file. */
  readonly completedWritePayloads: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<unknown>>;
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
    readonly readWrittenFile: (
      input: ThreadWrittenFileInput,
    ) => Effect.Effect<ThreadWrittenFileResult, ThreadFileWritesError>;
  }
>()("t3/zerops/ThreadFileWrites") {}

class Refusal {
  readonly reason: ThreadWrittenFileRefusal;
  readonly detail: string | undefined;
  constructor(reason: ThreadWrittenFileRefusal, detail?: string) {
    this.reason = reason;
    this.detail = detail;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The paths a stored completion shows its call wrote: none where the call failed or was declined. */
function writtenPaths(payload: unknown): string[] {
  const record = asRecord(payload);
  if (record === null || record.status === "failed" || record.status === "declined") return [];
  return readFileWritePaths(record.data);
}

function errorCode(cause: unknown): string | undefined {
  const code = asRecord(cause)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The path resolved a part at a time, each link on the way read by hand:
 * every one must be older than the thread. Its last part's `lstat`, for the
 * open to be checked against.
 */
async function walk(
  target: string,
  startedAtMs: number,
): Promise<{ readonly real: string; readonly stat: NodeFS.Stats }> {
  const { root } = NodePath.parse(target);
  const pending = target.slice(root.length).split(NodePath.sep).filter(Boolean);
  let resolved = root;
  let stat: NodeFS.Stats | null = null;
  let hops = 0;
  while (pending.length > 0) {
    const part = pending.shift()!;
    if (part === ".") continue;
    if (part === "..") {
      resolved = NodePath.dirname(resolved);
      stat = null;
      continue;
    }
    const next = NodePath.join(resolved, part);
    let entry: NodeFS.Stats;
    try {
      entry = await NodeFSP.lstat(next);
    } catch (cause) {
      throw new Refusal("not_file", errorCode(cause));
    }
    if (entry.isSymbolicLink()) {
      hops += 1;
      if (hops > MAX_LINK_HOPS) throw new Refusal("not_file", "ELOOP");
      // A link's change time cannot be set back by its owner: one made or
      // re-pointed during the thread reads as new, however it was touched.
      if (Math.max(entry.ctimeMs, entry.mtimeMs) >= startedAtMs) {
        throw new Refusal("link_after_thread");
      }
      const link = await NodeFSP.readlink(next);
      if (NodePath.isAbsolute(link)) resolved = NodePath.parse(link).root;
      pending.unshift(...link.split(NodePath.sep === "\\" ? /[\\/]/u : "/").filter(Boolean));
      stat = null;
      continue;
    }
    resolved = next;
    stat = entry;
  }
  if (stat === null || !stat.isFile()) throw new Refusal("not_file");
  // Another name for the file (a hard link) could be another file's content
  // under the name the agent wrote; content last written before the thread
  // is not what it wrote.
  if (stat.nlink > 1) throw new Refusal("not_written", "linked");
  if (stat.mtimeMs < startedAtMs) throw new Refusal("not_written", "older than the thread");
  return { real: resolved, stat };
}

/** The file read once, as the walk found it: refused if anything moved between. */
async function readChecked(
  found: { readonly real: string; readonly stat: NodeFS.Stats },
  asked: string,
): Promise<ThreadWrittenFileResult> {
  if (found.stat.size > WRITTEN_FILE_MAX_BYTES) throw new Refusal("too_large");
  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(
      found.real,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
    );
  } catch (cause) {
    throw new Refusal("not_file", errorCode(cause));
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== found.stat.dev || opened.ino !== found.stat.ino) {
      throw new Refusal("not_file", "changed");
    }
    if (opened.nlink > 1) throw new Refusal("not_written", "linked");
    if (opened.size > WRITTEN_FILE_MAX_BYTES) throw new Refusal("too_large");
    const buffer = Buffer.alloc(WRITTEN_FILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > WRITTEN_FILE_MAX_BYTES) throw new Refusal("too_large");
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) throw new Refusal("binary");
    let contents: string;
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Refusal("binary");
    }
    return { path: asked, contents, byteLength: bytesRead };
  } finally {
    await handle.close();
  }
}

export const make = (store: ThreadFileWritesStore): ThreadFileWrites["Service"] => {
  const fileWrites: ThreadFileWrites["Service"]["fileWrites"] = (input) =>
    Effect.gen(function* () {
      const asked = [...new Set(input.toolCallIds)];
      const rows = yield* store.callPayloads(input.threadId, asked);
      const calls = asked.flatMap((toolCallId) => {
        for (const row of rows) {
          if (row.callId !== toolCallId) continue;
          const writes = readFileWrites(asRecord(row.payload)?.data);
          if (writes.length > 0) return [{ toolCallId, writes }];
        }
        return [];
      });
      return { calls };
    });

  const readWrittenFile: ThreadFileWrites["Service"]["readWrittenFile"] = (input) =>
    Effect.gen(function* () {
      const refuse = (reason: ThreadWrittenFileRefusal, detail?: string) =>
        Effect.fail(
          new ThreadFileWritesError({ reason, ...(detail === undefined ? {} : { detail }) }),
        );
      if (!NodePath.isAbsolute(input.path) || input.path.includes("\0")) {
        return yield* refuse("not_absolute");
      }
      const startedAt = yield* store.threadStartedAt(input.threadId);
      if (Option.isNone(startedAt)) return yield* refuse("unavailable");
      const startedAtMs = Date.parse(startedAt.value);
      if (!Number.isFinite(startedAtMs)) return yield* refuse("unavailable");

      const asked = NodePath.resolve(input.path);
      const payloads = yield* store.completedWritePayloads(input.threadId);
      const written = payloads.some((payload) =>
        writtenPaths(payload).some(
          (path) => NodePath.isAbsolute(path) && NodePath.resolve(path) === asked,
        ),
      );
      if (!written) return yield* refuse("not_written");

      return yield* Effect.tryPromise({
        try: async () => readChecked(await walk(asked, startedAtMs), asked),
        catch: (cause) =>
          cause instanceof Refusal
            ? new ThreadFileWritesError({
                reason: cause.reason,
                ...(cause.detail === undefined ? {} : { detail: cause.detail }),
              })
            : new ThreadFileWritesError({ reason: "unavailable", detail: errorCode(cause) }),
      });
    });

  return ThreadFileWrites.of({ fileWrites, readWrittenFile });
};

/** The store over the thread's own projection rows. */
export const makeSqlStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A store that cannot answer answers nothing: nothing is served.
  const orNothing = <A>(fallback: A) => Effect.orElseSucceed(() => fallback);

  const threadStartedAt: ThreadFileWritesStore["threadStartedAt"] = (threadId) =>
    sql<{ readonly createdAt: string }>`
      SELECT created_at AS "createdAt"
      FROM projection_threads
      WHERE thread_id = ${threadId} AND deleted_at IS NULL
    `.pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0]?.createdAt)),
      orNothing(Option.none<string>()),
    );

  const parsed = (json: string): unknown => {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  const completedWritePayloads: ThreadFileWritesStore["completedWritePayloads"] = (threadId) =>
    sql<{ readonly payload: string }>`
      SELECT payload_json AS "payload"
      FROM projection_thread_activities
      WHERE thread_id = ${threadId}
        AND kind = 'tool.completed'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.itemType') = 'file_change'
      ORDER BY sequence ASC, created_at ASC, activity_id ASC
    `.pipe(
      Effect.map((rows) => rows.map((row) => parsed(row.payload))),
      orNothing<ReadonlyArray<unknown>>([]),
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

  return { threadStartedAt, completedWritePayloads, callPayloads } satisfies ThreadFileWritesStore;
});

export const layer = Layer.effect(ThreadFileWrites, Effect.map(makeSqlStore, make));
