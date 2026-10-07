import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  FILE_WRITES_RESPONSE_MAX_CHARS,
  make,
  makeEngineStore,
  makeSqlStore,
  type CompletedWrite,
  type ThreadFileWritesStore,
} from "./ThreadFileWrites.ts";
import { inertMateEngine, type MateEngineService } from "../engine/MateEngine.ts";

const THREAD = ThreadId.make("thread-writes");
const t = (second: number) => `2026-10-06T10:00:${String(second).padStart(2, "0")}.000Z`;

const writePayload = (path: string, content = "x") => ({
  itemType: "file_change",
  status: "completed",
  data: { toolName: "Write", input: { file_path: path, content } },
});
const editPayload = (path: string, before: string, after: string) => ({
  itemType: "file_change",
  status: "completed",
  data: { toolName: "Edit", input: { file_path: path, old_string: before, new_string: after } },
});

/** A store over rows already read: this thread's completed writes, oldest first, and its calls. */
function store(input: {
  readonly writes?: ReadonlyArray<CompletedWrite>;
  readonly calls?: ReadonlyArray<{ readonly callId: string; readonly payload: unknown }>;
}): ThreadFileWritesStore {
  return {
    completedWrites: () => Effect.succeed(input.writes ?? []),
    callPayloads: () => Effect.succeed(input.calls ?? []),
  };
}

const writtenFile = (path: string, writes: ReadonlyArray<CompletedWrite>) =>
  make(store({ writes }))
    .writtenFile({ threadId: THREAD, path })
    .pipe(
      Effect.map((file) => ({ shown: file }) as const),
      Effect.catchTag("ThreadFileWritesError", (error) =>
        Effect.succeed({ refused: error.reason } as const),
      ),
    );

describe("writtenFile — the Files tab's view of a file the agent wrote outside the workspace", () => {
  // Nothing here exists on disk: every answer is the thread's own record.
  const PATH = "/home/u/plan.md";
  const SECRET = "/home/u/.npmrc";

  it.effect("shows what the thread's newest completed write of the path wrote, and when", () =>
    Effect.gen(function* () {
      const writes: CompletedWrite[] = [
        { payload: writePayload(PATH, "first"), completedAt: t(1) },
        { payload: writePayload(PATH, "second"), completedAt: t(2) },
        { payload: { ...writePayload(PATH, "failed"), status: "failed" }, completedAt: t(3) },
      ];
      expect(yield* writtenFile(PATH, writes)).toEqual({
        shown: {
          write: {
            path: PATH,
            kind: "write",
            changes: [{ text: "second", removedLines: 0 }],
            truncated: false,
          },
          writtenAt: t(2),
        },
      });
    }),
  );

  it.effect("shows an edit's new text only, never the whole file nor the text it replaced", () =>
    Effect.gen(function* () {
      const writes = [
        { payload: editPayload(SECRET, "registry=old", "registry=new"), completedAt: t(4) },
      ];
      expect(yield* writtenFile(SECRET, writes)).toEqual({
        shown: {
          write: {
            path: SECRET,
            kind: "edit",
            changes: [{ text: "registry=new", removedLines: 1 }],
            truncated: false,
          },
          writtenAt: t(4),
        },
      });
    }),
  );

  it.effect.each([
    { name: "a path it never wrote", path: "/home/u/other.md", refused: "not_written" },
    { name: "the path with a space after it", path: `${PATH} `, refused: "not_written" },
    { name: "the path named another way", path: "/home/u/./plan.md", refused: "not_written" },
    { name: "a relative path", path: "plan.md", refused: "not_absolute" },
    {
      name: "a path only a failed call named",
      path: "/home/u/failed.md",
      refused: "not_written",
    },
    {
      name: "a path only a declined call named",
      path: "/home/u/declined.md",
      refused: "not_written",
    },
    {
      name: "a path only a call that never returned named",
      path: "/home/u/unreturned.md",
      refused: "not_written",
    },
    {
      name: "a path written with a space after it, asked as written",
      path: "/home/u/.claude.json ",
      refused: "not_written",
    },
  ])("refuses $name", ({ path, refused }) =>
    Effect.gen(function* () {
      const writes: CompletedWrite[] = [
        { payload: writePayload(PATH), completedAt: t(1) },
        { payload: { ...writePayload("/home/u/failed.md"), status: "failed" }, completedAt: t(2) },
        {
          payload: { ...writePayload("/home/u/declined.md"), status: "declined" },
          completedAt: t(3),
        },
        {
          payload: { ...writePayload("/home/u/unreturned.md"), unreturned: true },
          completedAt: t(4),
        },
        { payload: writePayload("/home/u/.claude.json "), completedAt: t(5) },
      ];
      expect(yield* writtenFile(path, writes)).toEqual({ refused });
    }),
  );
});

describe("fileWrites", () => {
  it.effect("answers each asked call by its newest payload that shows what it wrote", () =>
    Effect.gen(function* () {
      const service = make(
        store({
          calls: [
            // Newest first: a streamed update keeps no text, its start does.
            { callId: "call-a", payload: { itemType: "file_change", data: { wrote: true } } },
            { callId: "call-a", payload: writePayload("/srv/a.md", "A") },
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
            {
              path: "/srv/a.md",
              kind: "write",
              changes: [{ text: "A", removedLines: 0 }],
              truncated: false,
            },
          ],
        },
      ]);
    }),
  );

  it.effect("sends at most its cap in one answer, saying what it cut", () =>
    Effect.gen(function* () {
      const big = "y".repeat(60_000);
      const calls = Array.from({ length: 30 }, (_, index) => ({
        callId: `call-${index}`,
        payload: writePayload(`/srv/${index}.txt`, big),
      }));
      const result = yield* make(store({ calls })).fileWrites({
        threadId: THREAD,
        toolCallIds: calls.map((call) => call.callId),
      });
      const sent = result.calls
        .flatMap((call) => call.writes)
        .flatMap((write) => write.changes)
        .reduce((total, change) => total + change.text.length, 0);
      expect(sent).toBeLessThanOrEqual(FILE_WRITES_RESPONSE_MAX_CHARS);
      expect(result.calls.at(-1)?.writes.at(-1)?.truncated).toBe(true);
    }),
  );
});

describe("the sqlite store", () => {
  it.effect("reads this thread's completed rows that name a path, and its calls", () =>
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
      ) => sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence,
          created_at, call_id
        )
        VALUES (
          ${id}, ${threadId}, NULL, 'tool', ${kind}, 'Write', ${JSON.stringify(stored)},
          ${sequence}, ${t(sequence)}, ${callId}
        )
      `;
      yield* row("a1", THREAD, "tool.started", "call-1", writePayload("/srv/mine.txt"), 1);
      yield* row("a2", THREAD, "tool.completed", "call-1", writePayload("/srv/mine.txt"), 2);
      yield* row("a3", other, "tool.completed", "call-2", writePayload("/srv/mine.txt"), 3);
      yield* row("a4", THREAD, "tool.completed", "call-3", writePayload("/srv/other.txt"), 4);
      yield* row("a5", THREAD, "tool.completed", "call-4", writePayload("/srv/mine.txt"), 5);

      const sqlStore = yield* makeSqlStore;
      expect(yield* sqlStore.completedWrites(THREAD, "/srv/mine.txt")).toEqual([
        { payload: writePayload("/srv/mine.txt"), completedAt: t(2) },
        { payload: writePayload("/srv/mine.txt"), completedAt: t(5) },
      ]);
      const calls = yield* sqlStore.callPayloads(THREAD, ["call-1", "call-2"]);
      expect(calls.map((call) => call.callId)).toEqual(["call-1", "call-1"]);

      // Another thread's write of a path is nothing to this one.
      const refused = yield* make(sqlStore)
        .writtenFile({ threadId: THREAD, path: "/srv/theirs.txt" })
        .pipe(Effect.flip);
      expect(refused.reason).toBe("not_written");
      yield* row("a6", other, "tool.completed", "call-5", writePayload("/srv/theirs.txt"), 6);
      const stillRefused = yield* make(sqlStore)
        .writtenFile({ threadId: THREAD, path: "/srv/theirs.txt" })
        .pipe(Effect.flip);
      expect(stillRefused.reason).toBe("not_written");
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});

describe("the engine's store, while the Mate engine owns the conversation", () => {
  const conversation = "conversation-writes";
  const written = (itemId: string, state: string, path: string, content: string, at: number) => ({
    itemId,
    state,
    at,
    data: { toolName: "Write", input: { file_path: path, content } },
  });
  const engine = (rows: ReadonlyArray<ReturnType<typeof written>>): MateEngineService => ({
    ...inertMateEngine,
    live: true,
    callData: (_conversation, find) =>
      Effect.succeed(
        "itemIds" in find
          ? rows.filter((row) => find.itemIds.includes(row.itemId))
          : rows.filter((row) => JSON.stringify(row.data).includes(find.naming)),
      ),
  });

  it.effect("shows what the conversation's newest completed call wrote at a path, and when", () =>
    Effect.gen(function* () {
      const service = make(
        makeEngineStore(
          engine([
            written("i1", "done", "/etc/app.conf", "a=1\n", Date.parse("2026-10-07T10:00:00.000Z")),
            written("i2", "done", "/etc/app.conf", "a=2\n", Date.parse("2026-10-07T11:00:00.000Z")),
            written(
              "i3",
              "failed",
              "/etc/app.conf",
              "a=3\n",
              Date.parse("2026-10-07T12:00:00.000Z"),
            ),
          ]),
        ),
      );
      const result = yield* service.writtenFile({
        threadId: ThreadId.make(conversation),
        path: "/etc/app.conf",
      });
      expect(result.writtenAt).toBe("2026-10-07T11:00:00.000Z");
      expect(result.write.changes.map((change) => change.text).join("")).toContain("a=2");
    }),
  );

  it.effect("answers each asked call by the record kept beside its item", () =>
    Effect.gen(function* () {
      const service = make(
        makeEngineStore(engine([written("i1", "done", "/var/www/README.md", "# Hi\n", 1)])),
      );
      const result = yield* service.fileWrites({
        threadId: ThreadId.make(conversation),
        toolCallIds: ["i1", "i9"],
      });
      expect(
        result.calls.map((call) => [call.toolCallId, call.writes.map((write) => write.path)]),
      ).toEqual([["i1", ["/var/www/README.md"]]]);
    }),
  );
});
