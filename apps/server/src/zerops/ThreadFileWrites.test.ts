// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId } from "@t3tools/contracts";
import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  make,
  makeSqlStore,
  WRITTEN_FILE_MAX_BYTES,
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

const write = (path: string) => ({
  itemType: "file_change",
  status: "completed",
  data: { toolName: "Write", input: { file_path: path, content: "x" } },
});

/** A store over rows already read: this thread's completed writes, when it began. */
function store(input: {
  readonly writes: ReadonlyArray<unknown>;
  readonly startedAt?: string | null;
  readonly calls?: ReadonlyArray<{ readonly callId: string; readonly payload: unknown }>;
}): ThreadFileWritesStore {
  return {
    threadStartedAt: () =>
      Effect.succeed(
        input.startedAt === null ? Option.none() : Option.some(input.startedAt ?? BEFORE_ANY_LINK),
      ),
    completedWritePayloads: () => Effect.succeed(input.writes),
    callPayloads: () => Effect.succeed(input.calls ?? []),
  };
}

const read = (path: string, writes: ReadonlyArray<unknown>, startedAt?: string | null) =>
  make(store({ writes, ...(startedAt === undefined ? {} : { startedAt }) }))
    .readWrittenFile({ threadId: THREAD, path })
    .pipe(
      Effect.map((file) => ({ served: file.contents }) as const),
      Effect.catchTag("ThreadFileWritesError", (error) =>
        Effect.succeed({ refused: error.reason } as const),
      ),
    );

describe("readWrittenFile", () => {
  it.effect("serves a text file this thread wrote outside the workspace", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(at("notes.md"), "# Notes\n");
      expect(yield* read(at("notes.md"), [write(at("notes.md"))])).toEqual({
        served: "# Notes\n",
      });
    }),
  );

  it.effect("refuses every way around what it wrote", () =>
    Effect.gen(function* () {
      NodeFS.mkdirSync(at("out"), { recursive: true });
      NodeFS.writeFileSync(at("secret.txt"), "secret");
      NodeFS.writeFileSync(at("out", "a.txt"), "a");
      NodeFS.writeFileSync(at("out", "binary.bin"), Buffer.from([0x68, 0x00, 0x69]));
      NodeFS.writeFileSync(at("out", "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
      NodeFS.writeFileSync(at("out", "big.txt"), "y".repeat(WRITTEN_FILE_MAX_BYTES + 1));
      NodeFS.mkdirSync(at("out", "folder"), { recursive: true });
      // Links made after the thread began: the agent could have made them.
      NodeFS.symlinkSync(at("secret.txt"), at("out", "link.txt"));
      NodeFS.mkdirSync(at("real"), { recursive: true });
      NodeFS.writeFileSync(at("real", "b.txt"), "b");
      NodeFS.symlinkSync(at("real"), at("via"));
      // Another name for a file it never wrote; a file last written before the thread.
      NodeFS.linkSync(at("secret.txt"), at("out", "hard.txt"));
      NodeFS.writeFileSync(at("out", "stale.txt"), "stale");
      NodeFS.utimesSync(at("out", "stale.txt"), 946_684_000, 946_684_000);
      const written = [
        write(at("out", "hard.txt")),
        write(at("out", "stale.txt")),
        write(at("out", "a.txt")),
        write(at("out", "binary.bin")),
        write(at("out", "latin1.txt")),
        write(at("out", "big.txt")),
        write(at("out", "folder")),
        write(at("out", "missing.txt")),
        write(at("out", "link.txt")),
        write(at("via", "b.txt")),
      ];
      const cases: ReadonlyArray<readonly [string, string]> = [
        [at("secret.txt"), "not_written"],
        [`${at("out")}/../secret.txt`, "not_written"],
        [`${at("out", "a.txt")}/../../secret.txt`, "not_written"],
        ["out/a.txt", "not_absolute"],
        [at("out", "binary.bin"), "binary"],
        [at("out", "latin1.txt"), "binary"],
        [at("out", "big.txt"), "too_large"],
        [at("out", "folder"), "not_file"],
        [at("out", "missing.txt"), "not_file"],
        [at("out", "link.txt"), "link_after_thread"],
        [at("via", "b.txt"), "link_after_thread"],
        [at("out", "hard.txt"), "not_written"],
        [at("out", "stale.txt"), "not_written"],
      ];
      for (const [path, refused] of cases) {
        expect([path, yield* read(path, written)]).toEqual([path, { refused }]);
      }
      // The same path, as named with a needless `.` part: the file it wrote.
      expect(yield* read(`${at("out")}/./a.txt`, written)).toEqual({ served: "a" });
    }),
  );

  it.effect("follows a link that stood before the thread began", () =>
    Effect.gen(function* () {
      NodeFS.mkdirSync(at("old-real"), { recursive: true });
      NodeFS.writeFileSync(at("old-real", "c.txt"), "c");
      // Written after the thread began, as the thread's own write was.
      NodeFS.utimesSync(at("old-real", "c.txt"), 7_258_118_400, 7_258_118_400);
      NodeFS.symlinkSync(at("old-real"), at("old-link"));
      expect(
        yield* read(at("old-link", "c.txt"), [write(at("old-link", "c.txt"))], AFTER_EVERY_LINK),
      ).toEqual({ served: "c" });
    }),
  );

  it.effect("counts only a completed write, never a failed or declined one", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(at("tried.txt"), "t");
      const tried = (status: string) => ({ ...write(at("tried.txt")), status });
      expect(yield* read(at("tried.txt"), [tried("failed"), tried("declined")])).toEqual({
        refused: "not_written",
      });
    }),
  );

  it.effect("serves nothing of a thread that is gone", () =>
    Effect.gen(function* () {
      NodeFS.writeFileSync(at("gone.txt"), "g");
      expect(yield* read(at("gone.txt"), [write(at("gone.txt"))], null)).toEqual({
        refused: "unavailable",
      });
    }),
  );
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
  it.effect("reads this thread's completed writes and its calls, never another thread's", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const other = ThreadId.make("thread-other");
      const row = (
        id: string,
        threadId: string,
        kind: string,
        callId: string,
        payload: unknown,
        sequence: number,
      ) => sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence,
          created_at, call_id
        )
        VALUES (
          ${id}, ${threadId}, NULL, 'tool', ${kind}, 'Write', ${JSON.stringify(payload)},
          ${sequence}, '2026-10-06T10:00:00.000Z', ${callId}
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at, deleted_at
        )
        VALUES (
          ${THREAD}, 'project-1', 'Writes', '{}', 'full-access', 'default',
          NULL, NULL, NULL, '2026-10-06T09:00:00.000Z', '2026-10-06T09:00:00.000Z', NULL, NULL
        )
      `;
      yield* row("a1", THREAD, "tool.started", "call-1", write("/srv/mine.txt"), 1);
      yield* row("a2", THREAD, "tool.completed", "call-1", write("/srv/mine.txt"), 2);
      yield* row("a3", other, "tool.completed", "call-2", write("/srv/theirs.txt"), 3);
      yield* row(
        "a4",
        THREAD,
        "tool.completed",
        "call-3",
        { ...write("/srv/failed.txt"), status: "failed" },
        4,
      );

      const sqlStore = yield* makeSqlStore;
      expect(Option.getOrNull(yield* sqlStore.threadStartedAt(THREAD))).toBe(
        "2026-10-06T09:00:00.000Z",
      );
      expect(Option.isNone(yield* sqlStore.threadStartedAt(ThreadId.make("nope")))).toBe(true);
      const writes = yield* sqlStore.completedWritePayloads(THREAD);
      expect(writes).toEqual([
        write("/srv/mine.txt"),
        { ...write("/srv/failed.txt"), status: "failed" },
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
