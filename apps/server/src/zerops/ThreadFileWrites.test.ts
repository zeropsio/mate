// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId } from "@t3tools/contracts";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  isLocalFileSystem,
  make,
  makeSqlStore,
  WRITTEN_FILE_MAX_BYTES,
  type CompletedWrite,
  type ThreadFileWritesStore,
} from "./ThreadFileWrites.ts";

const THREAD = ThreadId.make("thread-writes");
/** A thread begun before every link a test makes: each is the thread's. */
const BEFORE_ANY_LINK = "2000-01-01T00:00:00.000Z";
/** A thread begun after every link a test makes: none is the thread's. */
const AFTER_EVERY_LINK = "2100-01-01T00:00:00.000Z";

let root = "";
beforeAll(() => {
  // A real directory, its links resolved: the walk compares real paths.
  root = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "file-writes-")));
});
afterAll(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

const at = (...parts: string[]) => NodePath.join(root, ...parts);
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
/** Long enough for a file's change time to move past a write's completion. */
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);

const payload = (path: string) => ({
  itemType: "file_change",
  status: "completed",
  data: { toolName: "Write", input: { file_path: path, content: "x" } },
});

/** The thread's write of a path, completed as the file stands now (or, for no file, long ago). */
function wrote(path: string, extra: Record<string, unknown> = {}): CompletedWrite {
  const stat = NodeFS.lstatSync(path, { throwIfNoEntry: false });
  return {
    payload: { ...payload(path), ...extra },
    completedAt: iso(stat === undefined ? 0 : Math.ceil(Math.max(stat.ctimeMs, stat.mtimeMs))),
  };
}

/** A store over rows already read: this thread's completed writes, when it began. */
function store(input: {
  readonly writes: ReadonlyArray<CompletedWrite>;
  readonly startedAt?: string | null;
  readonly calls?: ReadonlyArray<{ readonly callId: string; readonly payload: unknown }>;
}): ThreadFileWritesStore {
  return {
    threadStartedAt: () =>
      Effect.succeed(
        input.startedAt === null ? Option.none() : Option.some(input.startedAt ?? BEFORE_ANY_LINK),
      ),
    completedWrites: () => Effect.succeed(input.writes),
    callPayloads: () => Effect.succeed(input.calls ?? []),
  };
}

const LOCAL = () => true;

const read = (
  path: string,
  writes: ReadonlyArray<CompletedWrite>,
  options: { readonly startedAt?: string | null; readonly local?: (path: string) => boolean } = {},
) =>
  make(
    store({
      writes,
      ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
    }),
    // No slack: a change a moment after the write is a change.
    { slackMs: 0, isLocal: options.local ?? LOCAL },
  )
    .readWrittenFile({ threadId: THREAD, path })
    .pipe(
      Effect.map((file) => ({ served: file.contents }) as const),
      Effect.catchTag("ThreadFileWritesError", (error) =>
        Effect.succeed({ refused: error.reason } as const),
      ),
    );

describe("readWrittenFile", () => {
  it.effect("serves a text file this thread wrote outside the workspace, as it wrote it", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(at("notes.md"), "# Notes\n");
      expect(yield* read(at("notes.md"), [wrote(at("notes.md"))])).toEqual({
        served: "# Notes\n",
      });
    }),
  );

  it.effect("refuses every way around what it wrote", () =>
    Effect.gen(function* () {
      NodeFS.mkdirSync(at("out", "folder"), { recursive: true });
      NodeFS.writeFileSync(at("secret.txt"), "secret");
      for (const name of ["a.txt", "later.txt", "swapped.txt", "moved.txt", "space.txt"]) {
        NodeFS.writeFileSync(at("out", name), name);
      }
      NodeFS.writeFileSync(at("out", "binary.bin"), Buffer.from([0x68, 0x00, 0x69]));
      NodeFS.writeFileSync(at("out", "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
      NodeFS.writeFileSync(at("out", "big.txt"), "y".repeat(WRITTEN_FILE_MAX_BYTES + 1));
      NodeFS.writeFileSync(at("out", "stale.txt"), "stale");
      NodeFS.utimesSync(at("out", "stale.txt"), 946_684_000, 946_684_000);
      NodeFS.writeFileSync(at("out", "hard.txt"), "mine");
      NodeFS.writeFileSync(at("out", "unreturned.txt"), "u");
      // Links made after the thread began: the agent could have made them.
      NodeFS.symlinkSync(at("secret.txt"), at("out", "link.txt"));
      NodeFS.mkdirSync(at("real"), { recursive: true });
      NodeFS.writeFileSync(at("real", "b.txt"), "b");
      NodeFS.symlinkSync(at("real"), at("via"));
      const written = [
        "a.txt",
        "later.txt",
        "swapped.txt",
        "moved.txt",
        "binary.bin",
        "latin1.txt",
        "big.txt",
        "stale.txt",
        "hard.txt",
        "folder",
        "missing.txt",
        "link.txt",
      ].map((name) => wrote(at("out", name)));
      written.push(wrote(at("via", "b.txt")));
      written.push(wrote(at("out", "unreturned.txt"), { unreturned: true }));
      written.push(wrote(`${at("out", "space.txt")} `));
      written.push(wrote(`${at("out")}/./a.txt`));
      written.push(wrote("/dev/null"), wrote("/proc/self/environ"), wrote("/sys/kernel/notes"));

      // After the writes completed: the person signs in somewhere and the
      // file gets a token; another file takes a written file's name.
      pause();
      NodeFS.writeFileSync(at("out", "later.txt"), "token=secret");
      NodeFS.writeFileSync(at("secret-2.txt"), "secret");
      NodeFS.rmSync(at("out", "swapped.txt"));
      NodeFS.linkSync(at("secret-2.txt"), at("out", "swapped.txt"));
      NodeFS.rmSync(at("secret-2.txt"));
      NodeFS.writeFileSync(at("secret-3.txt"), "secret");
      NodeFS.renameSync(at("secret-3.txt"), at("out", "moved.txt"));
      NodeFS.linkSync(at("out", "hard.txt"), at("elsewhere.txt"));

      const cases: ReadonlyArray<readonly [string, string]> = [
        [at("secret.txt"), "not_written"],
        [`${at("out")}/../secret.txt`, "not_written"],
        [`${at("out", "a.txt")}/../../secret.txt`, "not_written"],
        // Only the path exactly as written: not the same file named another way.
        [`${at("out")}/./a.txt`, "not_written"],
        [`${at("out")}//a.txt`, "not_written"],
        [`${at("out", "space.txt")} `, "not_written"],
        [at("out", "space.txt"), "not_written"],
        ["out/a.txt", "not_absolute"],
        [at("out", "later.txt"), "changed_since_write"],
        [at("out", "swapped.txt"), "changed_since_write"],
        [at("out", "moved.txt"), "changed_since_write"],
        [at("out", "hard.txt"), "changed_since_write"],
        [at("out", "unreturned.txt"), "not_written"],
        [at("out", "binary.bin"), "binary"],
        [at("out", "latin1.txt"), "binary"],
        [at("out", "big.txt"), "too_large"],
        [at("out", "stale.txt"), "not_written"],
        [at("out", "folder"), "not_file"],
        [at("out", "missing.txt"), "not_file"],
        [at("out", "link.txt"), "link_after_thread"],
        [at("via", "b.txt"), "link_after_thread"],
        ["/dev/null", "system"],
        ["/proc/self/environ", "system"],
        ["/sys/kernel/notes", "system"],
      ];
      for (const [path, refused] of cases) {
        expect([path, yield* read(path, written)]).toEqual([path, { refused }]);
      }
      expect(yield* read(at("out", "a.txt"), written)).toEqual({ served: "a.txt" });
    }),
  );

  it.effect("follows a link that stood before the thread began, onto a local file system", () =>
    Effect.gen(function* () {
      NodeFS.mkdirSync(at("old-real"), { recursive: true });
      NodeFS.writeFileSync(at("old-real", "c.txt"), "c");
      // Written after the thread began, as the thread's own write was.
      NodeFS.utimesSync(at("old-real", "c.txt"), 7_258_118_400, 7_258_118_400);
      NodeFS.symlinkSync(at("old-real"), at("old-link"));
      NodeFS.symlinkSync("/dev", at("old-dev"));
      const writes = [wrote(at("old-link", "c.txt")), wrote(at("old-dev", "null"))];
      const later = { startedAt: AFTER_EVERY_LINK };
      expect(yield* read(at("old-link", "c.txt"), writes, later)).toEqual({ served: "c" });
      // A link into the server's own devices, however old.
      expect(yield* read(at("old-dev", "null"), writes, later)).toEqual({ refused: "system" });
      // A link, or the file, on a mount whose times its owner can set.
      const remoteLink = { ...later, local: (path: string) => !path.endsWith("old-link") };
      expect(yield* read(at("old-link", "c.txt"), writes, remoteLink)).toEqual({
        refused: "remote_fs",
      });
      const remoteFile = { ...later, local: (path: string) => !path.endsWith("c.txt") };
      expect(yield* read(at("old-link", "c.txt"), writes, remoteFile)).toEqual({
        refused: "remote_fs",
      });
    }),
  );

  it.effect("counts only a completed write, never a failed or declined one", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(at("tried.txt"), "t");
      const tried = (status: string) => wrote(at("tried.txt"), { status });
      expect(yield* read(at("tried.txt"), [tried("failed"), tried("declined")])).toEqual({
        refused: "not_written",
      });
    }),
  );

  it.effect("serves a file as the thread's newest write of it left it", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(at("twice.txt"), "first");
      const first = wrote(at("twice.txt"));
      pause();
      NodeFS.writeFileSync(at("twice.txt"), "second");
      const second = wrote(at("twice.txt"));
      expect(yield* read(at("twice.txt"), [second, first])).toEqual({ served: "second" });
      expect(yield* read(at("twice.txt"), [first])).toEqual({ refused: "changed_since_write" });
    }),
  );

  it.effect("serves nothing of a thread that is gone", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(at("gone.txt"), "g");
      expect(yield* read(at("gone.txt"), [wrote(at("gone.txt"))], { startedAt: null })).toEqual({
        refused: "unavailable",
      });
    }),
  );
});

describe("isLocalFileSystem", () => {
  it.each([
    { name: "ext4", platform: "linux", type: 0xef53, local: true },
    { name: "overlay", platform: "linux", type: 0x794c7630, local: true },
    { name: "tmpfs", platform: "linux", type: 0x01021994, local: true },
    { name: "xfs", platform: "linux", type: 0x58465342, local: true },
    { name: "FUSE", platform: "linux", type: 0x65735546, local: false },
    { name: "NFS", platform: "linux", type: 0x6969, local: false },
    { name: "SMB", platform: "linux", type: 0xfe534d42, local: false },
    { name: "APFS", platform: "darwin", type: 0x1a, local: true },
    { name: "an unknown platform", platform: "win32", type: 0xef53, local: false },
  ] as const)("$name on $platform", ({ platform, type, local }) => {
    expect(isLocalFileSystem(type, platform)).toBe(local);
  });
});

describe("fileWrites", () => {
  it.effect("answers each asked call by its newest payload that shows what it wrote", () =>
    Effect.gen(function* () {
      const service = make(
        store({
          writes: [],
          calls: [
            // Newest first: a streamed update keeps no text, its start does.
            { callId: "call-a", payload: { itemType: "file_change", data: { wrote: true } } },
            {
              callId: "call-a",
              payload: {
                itemType: "file_change",
                data: { toolName: "Write", input: { file_path: "/srv/a.md", content: "A" } },
              },
            },
            {
              callId: "call-read",
              payload: { data: { toolName: "Read", input: { file_path: "/srv/a.md" } } },
            },
          ],
        }),
      );
      const result = yield* service.fileWrites({
        threadId: THREAD,
        toolCallIds: ["call-read", "call-a", "call-unknown"],
      });
      expect(result.calls).toEqual([
        {
          toolCallId: "call-a",
          writes: [
            { path: "/srv/a.md", kind: "write", format: "content", text: "A", truncated: false },
          ],
        },
      ]);
    }),
  );
});

describe("the sqlite store", () => {
  it.effect("reads this thread's completed writes of a path and its calls, by server times", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const other = ThreadId.make("thread-other");
      const row = (
        id: string,
        threadId: string,
        kind: string,
        callId: string,
        stored: unknown,
        sequence: number,
        createdAt: string,
      ) => sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence,
          created_at, call_id
        )
        VALUES (
          ${id}, ${threadId}, NULL, 'tool', ${kind}, 'Write', ${JSON.stringify(stored)},
          ${sequence}, ${createdAt}, ${callId}
        )
      `;
      // The thread's own created_at is the browser's word: 1970 proves nothing.
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at, deleted_at
        )
        VALUES (
          ${THREAD}, 'project-1', 'Writes', '{}', 'full-access', 'default',
          NULL, NULL, NULL, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', NULL, NULL
        )
      `;
      const t = (second: number) => `2026-10-06T10:00:0${second}.000Z`;
      yield* row("a1", THREAD, "tool.started", "call-1", payload("/srv/mine.txt"), 1, t(1));
      yield* row("a2", THREAD, "tool.completed", "call-1", payload("/srv/mine.txt"), 2, t(2));
      yield* row("a3", other, "tool.completed", "call-2", payload("/srv/mine.txt"), 3, t(3));
      yield* row("a4", THREAD, "tool.completed", "call-3", payload("/srv/other.txt"), 4, t(4));
      yield* row("a5", THREAD, "tool.completed", "call-4", payload("/srv/mine.txt"), 5, t(5));

      const sqlStore = yield* makeSqlStore;
      // When the thread first worked, on the server's clock.
      expect(Option.getOrNull(yield* sqlStore.threadStartedAt(THREAD))).toBe(t(1));
      expect(Option.isNone(yield* sqlStore.threadStartedAt(ThreadId.make("nope")))).toBe(true);
      const writes = yield* sqlStore.completedWrites(THREAD, "/srv/mine.txt");
      expect(writes).toEqual([
        { payload: payload("/srv/mine.txt"), completedAt: t(2) },
        { payload: payload("/srv/mine.txt"), completedAt: t(5) },
      ]);
      const calls = yield* sqlStore.callPayloads(THREAD, ["call-1", "call-2"]);
      expect(calls.map((call) => call.callId)).toEqual(["call-1", "call-1"]);

      const service = make(sqlStore);
      const refused = yield* service
        .readWrittenFile({ threadId: THREAD, path: "/srv/theirs.txt" })
        .pipe(Effect.flip);
      expect(refused.reason).toBe("not_written");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
