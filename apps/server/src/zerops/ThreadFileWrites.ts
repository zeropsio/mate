// @effect-diagnostics nodeBuiltinImport:off
/**
 * What a thread's agent wrote, read back from the thread's own tool events.
 *
 * - `fileWrites` — a write's or an edit's row opens onto what it wrote: the
 *   call's payload as stored (the client's copy keeps none of it), read by
 *   `fileWrites.ts` for every driver that sends one.
 * - `readWrittenFile` — a file the thread's agent wrote outside the
 *   workspace, served read-only. The security model (design-decisions.md,
 *   2026-10-06), every time the server's own:
 *   - the path is absolute, normal, and exactly — untrimmed — one that a
 *     completed write or edit of THIS thread named (a failed, declined or
 *     never-returned call wrote nothing);
 *   - the file is unchanged since the thread's newest such write: its change
 *     and modify times are no later than that write's completion as the server
 *     stamped it (plus {@link WRITE_SLACK_MS}), before the read and after it.
 *     Nobody can set a change time back, so a token written in later, a file
 *     moved or linked onto the name, or a write during the read is refused;
 *   - it is resolved a part at a time, never into `/proc`, `/sys` or `/dev`
 *     (they name the server's own process), and every symbolic link met on
 *     the way must be older than the thread's first call and live on a local
 *     file system, as must the file: on a FUSE or network mount times can be
 *     set;
 *   - the file is opened without following a last link, and must be the very
 *     file the walk found (same device and inode); it has one name and was
 *     last written after the thread's first call;
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
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { readFileWritePaths, readFileWrites } from "./fileWrites.ts";

/** The largest written file served: past it, refused whole. */
export const WRITTEN_FILE_MAX_BYTES = 1024 * 1024;

/**
 * How much later than a write's stamped completion the file's own times may
 * read: the file is written before its call returns, on the same clock.
 */
export const WRITE_SLACK_MS = 1500;

/** How many links one path may pass through, as the kernel allows. */
const MAX_LINK_HOPS = 40;

/** Where a path names the server's own process and devices, never a file the agent wrote. */
const SYSTEM_ROOTS = ["/proc", "/sys", "/dev"] as const;

/**
 * File systems whose change times nobody can set (`statfs` `f_type`): Linux's
 * local ones, and APFS and HFS+ where a desktop runs. A FUSE or network mount
 * reports whatever times it is told.
 */
const LOCAL_FILE_SYSTEMS: Readonly<Record<string, ReadonlySet<number>>> = {
  linux: new Set([
    0xef53, // ext2/3/4
    0x58465342, // xfs
    0x9123683e, // btrfs
    0x01021994, // tmpfs
    0x794c7630, // overlayfs
    0x2fc12fc1, // zfs
    0xf2f52010, // f2fs
    0x858458f6, // ramfs
  ]),
  darwin: new Set([0x1a /* apfs */, 0x11 /* hfs */]),
};

/** Whether a file system's times are its own: only the known local ones. */
export function isLocalFileSystem(type: number, platform: string): boolean {
  return LOCAL_FILE_SYSTEMS[platform]?.has(type) ?? false;
}

/** Whether the file system an entry lives on (its folder's) keeps its own times. */
const onLocalFileSystem =
  (platform: string) =>
  async (path: string): Promise<boolean> => {
    try {
      const { type } = await NodeFSP.statfs(NodePath.dirname(path));
      return isLocalFileSystem(type, platform);
    } catch {
      return false;
    }
  };

/** A completed write of the thread, as stored: its payload, and when the server stamped it. */
export interface CompletedWrite {
  readonly payload: unknown;
  readonly completedAt: string;
}

/** What the service reads of the thread: its start, its completed writes, its calls' payloads. */
export interface ThreadFileWritesStore {
  /**
   * When the thread first worked, on the server's clock (its first call);
   * none when it is unknown, deleted, or never called a tool.
   */
  readonly threadStartedAt: (threadId: ThreadId) => Effect.Effect<Option.Option<string>>;
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

/**
 * The paths a stored completion shows its call wrote: none where the call
 * failed, was declined, or never returned (closed by its turn's end).
 */
function writtenPaths(payload: unknown): string[] {
  const record = asRecord(payload);
  if (record === null || record.status !== "completed" || record.unreturned === true) {
    return [];
  }
  return readFileWritePaths(record.data);
}

function insideSystemRoot(path: string): boolean {
  return SYSTEM_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

interface Checks {
  /** When the thread first worked: every link on the way is older, the file newer. */
  readonly startedAtMs: number;
  /** The latest the file's own times may read: its newest write's completion, plus slack. */
  readonly unchangedUntilMs: number;
  readonly isLocal: (path: string) => boolean | Promise<boolean>;
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
  checks: Checks,
): Promise<{ readonly real: string; readonly stat: NodeFS.Stats }> {
  if (insideSystemRoot(target)) throw new Refusal("system");
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
    if (insideSystemRoot(next)) throw new Refusal("system");
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
      if (Math.max(entry.ctimeMs, entry.mtimeMs) >= checks.startedAtMs) {
        throw new Refusal("link_after_thread");
      }
      if (!(await checks.isLocal(next))) throw new Refusal("remote_fs", "link");
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
  if (!(await checks.isLocal(resolved))) throw new Refusal("remote_fs");
  unchanged(stat, checks);
  // Another name for the file (a hard link) could be another file's content
  // under the name the agent wrote; content last written before the thread
  // is not what it wrote.
  if (stat.nlink > 1) throw new Refusal("not_written", "linked");
  if (stat.mtimeMs < checks.startedAtMs) {
    throw new Refusal("not_written", "older than the thread");
  }
  return { real: resolved, stat };
}

/**
 * The file as the thread's newest write of it left it: nothing has changed it
 * since — not its content (modify time), not its name, links or owner (change
 * time, which nobody can set back).
 */
function unchanged(stat: NodeFS.Stats, checks: Checks): void {
  if (Math.max(stat.ctimeMs, stat.mtimeMs) > checks.unchangedUntilMs) {
    throw new Refusal("changed_since_write");
  }
}

/** The file read once, as the walk found it: refused if anything moved before or during it. */
async function readChecked(
  found: { readonly real: string; readonly stat: NodeFS.Stats },
  asked: string,
  checks: Checks,
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
    unchanged(opened, checks);
    if (opened.nlink > 1) throw new Refusal("not_written", "linked");
    if (opened.size > WRITTEN_FILE_MAX_BYTES) throw new Refusal("too_large");
    const buffer = Buffer.alloc(WRITTEN_FILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > WRITTEN_FILE_MAX_BYTES) throw new Refusal("too_large");
    // Written to while it was read: what was read is not what the agent wrote.
    const after = await handle.stat();
    if (after.ctimeMs !== opened.ctimeMs || after.mtimeMs !== opened.mtimeMs) {
      throw new Refusal("changed_since_write", "during the read");
    }
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

export interface ThreadFileWritesOptions {
  /** How much later than its write's completion a file's times may read. */
  readonly slackMs?: number;
  /** Whether the file system an entry lives on keeps its own times. */
  readonly isLocal?: (path: string) => boolean | Promise<boolean>;
  /** The platform the server runs on, whose file system types it knows. */
  readonly platform?: string;
}

export const make = (
  store: ThreadFileWritesStore,
  options: ThreadFileWritesOptions = {},
): ThreadFileWrites["Service"] => {
  const slackMs = options.slackMs ?? WRITE_SLACK_MS;
  const isLocal = options.isLocal ?? onLocalFileSystem(options.platform ?? "unknown");
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
      const path = input.path;
      if (!NodePath.isAbsolute(path) || path.includes("\0")) return yield* refuse("not_absolute");
      // Only the path exactly as a write named it, and only in its one normal
      // form: `/a/./b`, `/a//b`, `/a/x/../b` or `/a/b ` may each be another file.
      if (path !== path.trim() || path !== NodePath.resolve(path)) {
        return yield* refuse("not_written");
      }
      const startedAt = yield* store.threadStartedAt(input.threadId);
      if (Option.isNone(startedAt)) return yield* refuse("unavailable");
      const startedAtMs = Date.parse(startedAt.value);
      if (!Number.isFinite(startedAtMs)) return yield* refuse("unavailable");

      const completions = (yield* store.completedWrites(input.threadId, path))
        .filter((write) => writtenPaths(write.payload).includes(path))
        .map((write) => Date.parse(write.completedAt))
        .filter(Number.isFinite);
      if (completions.length === 0) return yield* refuse("not_written");
      const checks: Checks = {
        startedAtMs,
        unchangedUntilMs: Math.max(...completions) + slackMs,
        isLocal,
      };

      return yield* Effect.tryPromise({
        try: async () => readChecked(await walk(path, checks), path, checks),
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

  // Server times only: a thread's own `created_at` is the time its creating
  // command carried, which the browser sets. Its first call's row is stamped
  // by this server as the agent's event arrived.
  const threadStartedAt: ThreadFileWritesStore["threadStartedAt"] = (threadId) =>
    sql<{ readonly startedAt: string | null }>`
      SELECT MIN(activity.created_at) AS "startedAt"
      FROM projection_threads AS thread
      JOIN projection_thread_activities AS activity ON activity.thread_id = thread.thread_id
      WHERE thread.thread_id = ${threadId}
        AND thread.deleted_at IS NULL
        AND activity.kind IN ('tool.started', 'tool.updated', 'tool.completed')
    `.pipe(
      Effect.map((rows) => Option.fromNullishOr(rows[0]?.startedAt)),
      orNothing(Option.none<string>()),
    );

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

  return { threadStartedAt, completedWrites, callPayloads } satisfies ThreadFileWritesStore;
});

export const layer = Layer.effect(
  ThreadFileWrites,
  Effect.gen(function* () {
    const store = yield* makeSqlStore;
    return make(store, { platform: yield* HostProcessPlatform });
  }),
);
