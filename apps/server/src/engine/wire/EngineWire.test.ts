// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  MATE_ENGINE_PROTOCOLS,
  RequestId,
  runId,
  type ChatAttachment,
  type ChatImageAttachment,
  type EngineConversationFrame,
  type EngineCursor,
  type EngineRowsFrame,
  type EngineSubscribeInput,
} from "@t3tools/contracts";

import { createPendingAttachmentId, resolveAttachmentPath } from "../../attachmentStore.ts";
import * as ServerConfigModule from "../../config.ts";
import { ServerConfig } from "../../config.ts";
import { serverMessagePictures } from "../../zerops/engineAdapters.ts";
import { MessagePictures } from "../ports.ts";
import { PIXEL } from "../testing/bridge/callHeavy.ts";
import { makeEngineWorld, mate, type EngineWorld } from "../testing/pump/engineWorld.ts";
import {
  NOT_ON_ENGINE,
  makeEngineWire,
  unservedWire,
  type EngineWireOptions,
  type WireCaller,
} from "./EngineWire.ts";

const ana: WireCaller = { subject: "zerops-user:ana", environmentId: "env-1", epoch: 4 };
const protocol = MATE_ENGINE_PROTOCOLS[0]!;
const preview = {
  type: "image",
  id: "img-q",
  name: "question-preview.png",
  mimeType: "image/png",
  sizeBytes: 2048,
} as unknown as ChatImageAttachment;

const world = Effect.gen(function* () {
  const w = yield* makeEngineWorld({ driver: "claudeAgent" });
  yield* w.boot;
  yield* w.tell({
    _tag: "AssignAgent",
    agent: {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "m1",
      profile: { kind: "mate" },
    },
  });
  return w;
});

const wireOf = (w: EngineWorld, options: EngineWireOptions = {}) =>
  w.within(makeEngineWire({ coalesce: 0, ...options }));

/** Every frame the subscription sends, as it sends them. */
const watch = (
  w: EngineWorld,
  wire: Effect.Success<ReturnType<typeof wireOf>>,
  input: Partial<EngineSubscribeInput> = {},
  caller: WireCaller = ana,
) =>
  Effect.gen(function* () {
    const frames: Array<EngineConversationFrame> = [];
    yield* Stream.runForEach(
      wire.subscribe({ protocol, conversationId: mate, ...input }, caller),
      (frame) => Effect.sync(() => frames.push(frame)),
    ).pipe(Effect.forkScoped);
    yield* w.settle;
    return frames;
  });

const kinds = (frames: ReadonlyArray<EngineConversationFrame>) => frames.map((frame) => frame.type);

const cursorOf = (frames: ReadonlyArray<EngineConversationFrame>): EngineCursor => {
  const origin = frames.find((frame) => frame.type === "snapshot");
  const synced = frames.findLast((frame) => frame.type === "synchronized");
  const changes = frames.findLast((frame) => frame.type === "changes");
  if (origin?.type !== "snapshot" || synced?.type !== "synchronized") throw new Error("no cursor");
  return {
    epoch: synced.epoch,
    origin: origin.origin,
    seq: Math.max(synced.head, changes?.type === "changes" ? changes.to : 0),
  };
};

const send = (
  wire: Effect.Success<ReturnType<typeof wireOf>>,
  text: string,
  commandId = `send-${text}`,
) => wire.send({ protocol, conversationId: mate, commandId: CommandId.make(commandId), text }, ana);

describe("a client subscribed to an engine conversation", () => {
  it.effect(
    "gets the window snapshot, then synchronized, then each commit's changes in order",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          yield* w.tell({ _tag: "Send", text: "Deploy the api" });
          yield* w.agent((agent, thread) => agent.say(thread, "Deployed."));
          yield* w.agent((agent, thread) => agent.finish(thread));

          const frames = yield* watch(w, wire);
          assert.deepStrictEqual(kinds(frames), ["snapshot", "synchronized"]);
          const snapshot = frames[0]!;
          if (snapshot.type !== "snapshot") return;
          assert.strictEqual(snapshot.epoch, ana.epoch);
          assert.strictEqual(snapshot.header.agent?.instanceId, "claudeAgent");
          assert.strictEqual(snapshot.header.runStatus, "ready");
          assert.strictEqual(snapshot.header.activeRunId, null);
          assert.strictEqual(snapshot.header.latestRunId, runId(mate, 1));
          assert.strictEqual(snapshot.runs[0]?.turnState, "completed");
          assert.deepStrictEqual(
            snapshot.runs.map((run) => [run.id, run.state, run.summary.answerItemId !== null]),
            [[runId(mate, 1), "ended", true]],
          );
          assert.deepStrictEqual(
            snapshot.items.map((item) => [item.kind, "text" in item ? item.text : null]),
            [
              ["person", "Deploy the api"],
              ["note", "Deployed."],
            ],
          );

          yield* w.tell({ _tag: "Send", text: "And the worker" });
          yield* w.agent((agent, thread) => agent.say(thread, "On it."));
          const changes = frames.slice(2).filter((frame) => frame.type === "changes");
          assert.isAbove(changes.length, 0);
          let cursor = snapshot.head;
          for (const frame of changes) {
            if (frame.type !== "changes") continue;
            assert.strictEqual(frame.from, cursor, "each change follows the last");
            assert.isAtLeast(frame.to, frame.from);
            cursor = frame.to;
          }
          // Records are upserted by id: the latest version of each is what the client holds.
          const held = new Map(
            changes
              .flatMap((frame) => (frame.type === "changes" ? frame.items : []))
              .map((item) => [item.id, item] as const),
          );
          assert.deepStrictEqual(
            [...held.values()]
              .filter((item) => item.kind === "person" || (item.kind === "note" && !item.streaming))
              .map((item) => ("text" in item ? item.text : null)),
            ["And the worker", "On it."],
          );
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("resumes after a reconnect from its cursor with only what is newer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "First" });
        yield* w.agent((agent, thread) => agent.say(thread, "One."));
        yield* w.agent((agent, thread) => agent.finish(thread));
        const before = yield* Effect.scoped(watch(w, wire));
        const cursor = cursorOf(before);

        yield* w.tell({ _tag: "Send", text: "Second" });
        const after = yield* watch(w, wire, { after: cursor });
        assert.deepStrictEqual(kinds(after), ["changes", "synchronized"]);
        const resumed = after[0]!;
        if (resumed.type !== "changes") return;
        assert.strictEqual(resumed.from, cursor.seq);
        assert.deepStrictEqual(
          resumed.items.map((item) => ("text" in item ? item.text : item.kind)),
          ["Second"],
        );
        assert.deepStrictEqual(
          resumed.runs.map((run) => run.id),
          [runId(mate, 2)],
        );
        assert.isDefined(resumed.header, "a resume carries the conversation's header");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("resumes across the Mate's restart: a newer epoch fetches nothing again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "First" });
        const cursor = cursorOf(yield* Effect.scoped(watch(w, wire)));
        const restarted = { ...ana, epoch: ana.epoch + 1 };
        const after = yield* watch(w, wire, { after: cursor }, restarted);
        assert.deepStrictEqual(kinds(after), ["changes", "synchronized"]);
        const resumed = after[0]!;
        if (resumed.type !== "changes") return;
        assert.strictEqual(resumed.epoch, restarted.epoch);
        assert.deepStrictEqual(resumed.items, []);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect.each([
    {
      name: "another sequence space (the engine's tables made again)",
      reason: "origin" as const,
      move: (cursor: EngineCursor) => ({ ...cursor, origin: "elsewhere" }),
    },
    {
      name: "an epoch ahead of the Mate's (a restored state)",
      reason: "epoch" as const,
      move: (cursor: EngineCursor) => ({ ...cursor, epoch: cursor.epoch + 5 }),
    },
    {
      name: "a sequence past the conversation's head",
      reason: "ahead" as const,
      move: (cursor: EngineCursor) => ({ ...cursor, seq: cursor.seq + 1_000 }),
    },
  ])("is reset to a fresh snapshot from a cursor of $name", ({ reason, move }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "First" });
        const cursor = cursorOf(yield* Effect.scoped(watch(w, wire)));
        const frames = yield* watch(w, wire, { after: move(cursor) });
        assert.deepStrictEqual(kinds(frames), ["reset", "snapshot", "synchronized"]);
        assert.deepStrictEqual(frames[0], { type: "reset", reason });
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("is reset to a fresh snapshot when more changed than a resume carries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w, { resumeRecords: 2 });
        yield* w.tell({ _tag: "Send", text: "First" });
        const cursor = cursorOf(yield* Effect.scoped(watch(w, wire)));
        yield* w.agent((agent, thread) => agent.say(thread, "One."));
        yield* w.agent((agent, thread) => agent.say(thread, "Two."));
        yield* w.agent((agent, thread) => agent.finish(thread));
        const frames = yield* watch(w, wire, { after: cursor });
        assert.deepStrictEqual(kinds(frames), ["reset", "snapshot", "synchronized"]);
        assert.deepStrictEqual(frames[0], { type: "reset", reason: "gap" });
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("gets streamed text by its item, and the boundary record replaces it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "Explain" });
        const frames = yield* watch(w, wire);
        yield* w.agent((agent, thread) => agent.stream(thread, "live-1", "Hel"));
        yield* w.agent((agent, thread) => agent.stream(thread, "live-1", "lo"));
        const live = frames.filter((frame) => frame.type.startsWith("live."));
        const note = frames
          .flatMap((frame) => (frame.type === "changes" ? frame.items : []))
          .find((item) => item.kind === "note");
        assert.isDefined(note, "the streaming item's record arrives first");
        assert.deepStrictEqual(
          live.map((frame) =>
            frame.type === "live.open" || frame.type === "live.append"
              ? [frame.itemId, frame.text]
              : frame,
          ),
          [
            [note!.id, "Hel"],
            [note!.id, "lo"],
          ],
        );
        const streamed = frames.length;

        yield* w.agent((agent, thread) => agent.finish(thread));
        const after = frames.slice(streamed);
        const boundary = after.findIndex(
          (frame) =>
            frame.type === "changes" &&
            frame.items.some(
              (item) => item.id === note!.id && item.kind === "note" && !item.streaming,
            ),
        );
        const settle = after.findIndex(
          (frame) => frame.type === "live.settle" && frame.itemId === note!.id,
        );
        assert.isAtLeast(boundary, 0, "the boundary record arrives");
        assert.isAbove(settle, boundary, "the streamed text is settled after its record");
        const closed = after
          .flatMap((frame) => (frame.type === "changes" ? frame.items : []))
          .find((item) => item.id === note!.id);
        assert.strictEqual(closed?.kind === "note" ? closed.text : null, "Hello");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("opens with the text streamed so far when it subscribes mid-stream", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "Explain" });
        yield* w.agent((agent, thread) => agent.stream(thread, "live-1", "Half a tho"));
        const frames = yield* watch(w, wire);
        const opened = frames.find((frame) => frame.type === "live.open");
        assert.deepStrictEqual(
          kinds(frames).slice(0, 2),
          ["snapshot", "synchronized"],
          "the record first",
        );
        assert.strictEqual(opened?.type === "live.open" ? opened.text : null, "Half a tho");
        yield* w.shutdown;
      }),
    ),
  );
});

describe("a client reading more of an engine conversation", () => {
  it.effect("opens on the newest run groups and reads older ones whole on demand", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        for (const text of ["One", "Two", "Three"]) {
          yield* w.tell({ _tag: "Send", text });
          yield* w.agent((agent, thread) => agent.say(thread, `${text} done.`));
          yield* w.agent((agent, thread) => agent.finish(thread));
        }
        const [snapshot] = yield* Effect.scoped(watch(w, wire, { groups: 1 }));
        if (snapshot?.type !== "snapshot") throw new Error("no snapshot");
        assert.deepStrictEqual(
          snapshot.runs.map((run) => run.ordinal),
          [3],
        );
        assert.deepStrictEqual(snapshot.window, { oldestOrdinal: 3, earlier: true });

        const page = yield* wire.readEarlier({
          protocol,
          conversationId: mate,
          beforeOrdinal: 3,
        });
        if (page._tag !== "Page") throw new Error(page._tag);
        assert.deepStrictEqual(
          page.runs.map((run) => run.ordinal),
          [1, 2],
        );
        assert.deepStrictEqual(
          page.items.map((item) => ("text" in item ? item.text : item.kind)),
          ["One", "One done.", "Two", "Two done."],
        );
        assert.deepStrictEqual(page.window, { oldestOrdinal: 1, earlier: false });
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("reads a run's items page by page, the newest first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "Go" });
        for (const text of ["a", "b", "c"])
          yield* w.agent((agent, thread) => agent.say(thread, text));
        const read = (beforeSeq?: number) =>
          wire.readRun({
            protocol,
            conversationId: mate,
            runId: runId(mate, 1),
            limit: 2,
            ...(beforeSeq === undefined ? {} : { beforeSeq }),
          });
        const newest = yield* read();
        if (newest._tag !== "Page") throw new Error(newest._tag);
        assert.deepStrictEqual(
          newest.items.map((item) => ("text" in item ? item.text : item.kind)),
          ["b", "c"],
        );
        assert.isTrue(newest.more);
        const older = yield* read(newest.items[0]!.seq);
        if (older._tag !== "Page") throw new Error(older._tag);
        assert.deepStrictEqual(
          older.items.map((item) => ("text" in item ? item.text : item.kind)),
          ["Go", "a"],
        );
        assert.isFalse(older.more);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("reads a run's items from its start page by page, the oldest first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "Go" });
        for (const text of ["a", "b", "c"])
          yield* w.agent((agent, thread) => agent.say(thread, text));
        const read = (afterSeq: number) =>
          wire.readRun({
            protocol,
            conversationId: mate,
            runId: runId(mate, 1),
            limit: 2,
            afterSeq,
          });
        const first = yield* read(0);
        if (first._tag !== "Page") throw new Error(first._tag);
        assert.deepStrictEqual(
          first.items.map((item) => ("text" in item ? item.text : item.kind)),
          ["Go", "a"],
        );
        assert.isTrue(first.more);
        const later = yield* read(first.items.at(-1)!.seq);
        if (later._tag !== "Page") throw new Error(later._tag);
        assert.deepStrictEqual(
          later.items.map((item) => ("text" in item ? item.text : item.kind)),
          ["b", "c"],
        );
        assert.isFalse(later.more);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("reads only what a run's closed card draws its result from, wherever it stands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* w.tell({ _tag: "Send", text: "Deploy" });
        yield* w.agent((agent, thread) => agent.say(thread, "On it"));
        yield* w.agent((agent, thread) => agent.change(thread, ["src/main.ts"]));
        yield* w.agent((agent, thread) =>
          agent.zerops(thread, "zerops_deploy", { targetService: "api" }, "api", '{"ok":true}'),
        );
        yield* w.agent((agent, thread) => agent.say(thread, "Deployed"));
        yield* w.agent((agent, thread) => agent.finish(thread));
        const page = yield* wire.readRun({
          protocol,
          conversationId: mate,
          runId: runId(mate, 1),
          afterSeq: 0,
          only: "outcome",
        });
        if (page._tag !== "Page") throw new Error(page._tag);
        assert.deepStrictEqual(
          page.items.map((item) => (item.kind === "call" ? item.tool.name : item.kind)),
          ["zerops_deploy"],
        );
        assert.isFalse(page.more);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "counts a run's generic calls by their tool, and the files its edits changed once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          yield* w.tell({ _tag: "Send", text: "Fix it" });
          yield* w.agent((agent, thread) => agent.change(thread, ["src/a.ts", "src/b.ts"]));
          yield* w.agent((agent, thread) => agent.change(thread, ["src/a.ts"]));
          yield* w.agent((agent, thread) => agent.write(thread, "notes.md", "x"));
          for (const tool of ["zerops_workflow", "zerops_workflow", "zerops_knowledge"])
            yield* w.agent((agent, thread) => agent.zerops(thread, tool, {}, "{}", "{}"));
          yield* w.agent((agent, thread) => agent.finish(thread));
          const [snapshot] = yield* Effect.scoped(watch(w, wire));
          if (snapshot?.type !== "snapshot") throw new Error("no snapshot");
          const { summary } = snapshot.runs.at(-1)!;
          assert.deepStrictEqual(summary.tools, {
            zerops_workflow: 2,
            zerops_knowledge: 1,
          });
          // Two files named, and the write that names none counted once.
          assert.strictEqual(summary.edited, 3);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("gets a long message cut to the wire's budget and reads it whole on demand", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        const text = "Log line. ".repeat(3_000);
        yield* send(wire, text);
        const [snapshot] = yield* Effect.scoped(watch(w, wire));
        if (snapshot?.type !== "snapshot") throw new Error("no snapshot");
        const person = snapshot.items.find((item) => item.kind === "person");
        assert.deepStrictEqual(person?.cut, { part: "text", total: text.length });
        const whole = yield* wire.readDetail({
          protocol,
          conversationId: mate,
          itemId: person!.id,
          part: "text",
        });
        assert.deepStrictEqual(whole, {
          _tag: "Detail",
          text,
          from: 0,
          to: text.length,
          total: text.length,
        });
        yield* w.shutdown;
      }),
    ),
  );
});

describe("a client reading an engine call", () => {
  it.effect(
    "gets a deploy's line and result on its record, a long result cut and read whole on demand",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          const deployed = `{"status":"DEPLOYED","buildLogs":"${"ok\\n".repeat(9_000)}"}`;
          yield* send(wire, "Deploy the api");
          yield* w.settle;
          yield* w.agent((agent, thread) =>
            agent.zerops(
              thread,
              "zerops_deploy",
              { targetService: "api" },
              '{"targetService":"api"}',
              deployed,
            ),
          );
          yield* w.agent((agent, thread) => agent.finish(thread));
          const [snapshot] = yield* Effect.scoped(watch(w, wire));
          if (snapshot?.type !== "snapshot") throw new Error("no snapshot");
          const run = snapshot.runs.at(-1)!;
          const page = yield* wire.readRun({ protocol, conversationId: mate, runId: run.id });
          if (page._tag !== "Page") throw new Error(page._tag);
          const call = page.items.find((item) => item.kind === "call");
          if (call?.kind !== "call") throw new Error("no call");
          assert.strictEqual(call.step, "mcp");
          assert.strictEqual(call.input, 'mcp__zerops__zerops_deploy: {"targetService":"api"}');
          assert.deepStrictEqual(call.shows, {
            toolName: "mcp__zerops__zerops_deploy",
            input: { targetService: "api" },
            // V1's row shows a result's first line, cut.
            result: { content: `${deployed.slice(0, 83)}…` },
          });
          assert.deepStrictEqual(call.result, { toolName: "zerops_deploy" });
          assert.deepStrictEqual(call.cut, { part: "result", total: deployed.length });
          const whole = yield* wire.readDetail({
            protocol,
            conversationId: mate,
            itemId: call.id,
            part: "result",
          });
          assert.deepStrictEqual(whole, {
            _tag: "Detail",
            text: deployed,
            from: 0,
            to: deployed.length,
            total: deployed.length,
          });
          yield* w.shutdown;
        }),
      ),
  );
});

describe("a client subscribed to a Mate's conversation rows", () => {
  it.effect("gets each conversation's row with its agent, then the row again as it changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        const frames: Array<EngineRowsFrame> = [];
        yield* Stream.runForEach(wire.subscribeRows({ protocol }, ana), (frame) =>
          Effect.sync(() => frames.push(frame)),
        ).pipe(Effect.forkScoped);
        yield* w.settle;
        const [snapshot] = frames;
        if (snapshot?.type !== "snapshot") throw new Error("no snapshot");
        assert.deepStrictEqual(
          snapshot.rows.map((row) => [row.conversationId, row.agent?.driver, row.revision.epoch]),
          [[mate, "claudeAgent", ana.epoch]],
        );
        yield* w.tell({ _tag: "Send", text: "Ship it\nnow" });
        const rows = frames.flatMap((frame) => (frame.type === "row" ? [frame.row] : []));
        assert.strictEqual(rows.at(-1)?.subject, "Ship it");
        assert.isAbove(rows.at(-1)!.revision.seq, snapshot.rows[0]!.revision.seq);
        yield* w.shutdown;
      }),
    ),
  );
});

describe("a client's calls to an engine conversation", () => {
  // Catches a send right after a flipped Mate's restart taking run 1, so its earlier record is
  // never brought in: the send waits until the conversation is adopted.
  it.effect("a send waits while the Mate holds sends, and is applied once it lets them go", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const held = yield* Deferred.make<void>();
        const wire = yield* wireOf(w, { sendsWait: Deferred.await(held) });
        const sent = yield* Effect.forkScoped(send(wire, "Hello"));
        yield* w.settle;
        const before = yield* w.within(
          Effect.flatMap(SqlClient.SqlClient, (sql) => sql`SELECT run_id FROM engine_run`),
        );
        assert.deepStrictEqual(before, []);
        yield* Deferred.succeed(held, undefined);
        const result = yield* Fiber.join(sent);
        assert.strictEqual(result._tag, "Accepted");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a send is confirmed when the engine accepts it, as the person who sent it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        const result = yield* send(wire, "Hello");
        assert.strictEqual(result._tag, "Accepted");
        if (result._tag !== "Accepted") return;
        assert.strictEqual(result.runId, runId(mate, 1));
        const principals = yield* w.within(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) =>
              sql<{ readonly principal_json: string }>`SELECT principal_json FROM engine_run`,
          ),
        );
        assert.deepStrictEqual(
          principals.map((row) => JSON.parse(row.principal_json)),
          [{ kind: "person", subject: "zerops-user:ana" }],
        );
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a crewmate's chat takes a person's message only through its crew", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        yield* w.tell({
          _tag: "AssignAgent",
          agent: {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            model: "m1",
            profile: { kind: "crewmate", id: "backend", name: "Backend" },
          },
        });
        const wire = yield* wireOf(w);
        const result = yield* send(wire, "Hello");
        assert.deepStrictEqual(result, {
          _tag: "Rejected",
          rejection: {
            reason: "unknown",
            detail: "A crewmate's chat takes messages through its crew.",
          },
        });
        assert.deepStrictEqual(yield* w.runs, []);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a model switch becomes the conversation's model, asked by the person who sent it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          const result = yield* wire.switchModel(
            {
              protocol,
              conversationId: mate,
              commandId: CommandId.make("switch-1"),
              model: "claude-opus-4-1",
            },
            ana,
          );
          assert.strictEqual(result._tag, "Accepted");
          const frames = yield* watch(w, wire);
          const snapshot = frames.find((frame) => frame.type === "snapshot");
          assert.strictEqual(
            snapshot?.type === "snapshot" && snapshot.header.model,
            "claude-opus-4-1",
          );
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "a message in an interaction mode this engine does not know goes in the default mode",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          const result = yield* wire.send(
            {
              protocol,
              conversationId: mate,
              commandId: CommandId.make("send-review"),
              text: "Look it over",
              interactionMode: "unknown",
            },
            ana,
          );
          assert.strictEqual(result._tag, "Accepted");
          const frames = yield* watch(w, wire);
          const snapshot = frames.find((frame) => frame.type === "snapshot");
          if (snapshot?.type !== "snapshot") return assert.fail("no snapshot");
          assert.strictEqual(snapshot.header.interactionMode ?? "default", "default");
          const sent = w.provider.sends.at(-1) as { readonly interactionMode?: string } | undefined;
          assert.strictEqual(sent?.interactionMode ?? "default", "default");
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "a model switch carries its options, and the header names the conversation's runtime mode and latest interaction mode",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          const call = { protocol, conversationId: mate } as const;
          const effort = [{ id: "effort", value: "max" }];
          const switched = yield* wire.switchModel(
            { ...call, commandId: CommandId.make("switch-1"), model: "m1", options: effort },
            ana,
          );
          const mode = yield* wire.setRuntimeMode(
            {
              ...call,
              commandId: CommandId.make("mode-1"),
              runtimeMode: "approval-required",
            },
            ana,
          );
          yield* wire.send(
            {
              ...call,
              commandId: CommandId.make("send-plan"),
              text: "Plan the migration",
              interactionMode: "plan",
            },
            ana,
          );
          assert.deepStrictEqual([switched._tag, mode._tag], ["Accepted", "Accepted"]);
          const frames = yield* watch(w, wire);
          const snapshot = frames.find((frame) => frame.type === "snapshot");
          if (snapshot?.type !== "snapshot") return assert.fail("no snapshot");
          assert.deepStrictEqual(snapshot.header.agent?.options, effort);
          assert.strictEqual(snapshot.header.runtimeMode, "approval-required");
          assert.strictEqual(snapshot.header.interactionMode, "plan");
          assert.deepInclude(w.provider.sends.at(-1), { interactionMode: "plan" });
          assert.deepInclude(w.provider.starts.at(-1), { runtimeMode: "approval-required" });
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "a session opened after an agent pick resumes from the state another instance of its driver left",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* makeEngineWorld({
            driver: "claudeAgent",
            handedOver: ({ instanceId }) =>
              instanceId === "claudeAgent:second" ? { session: "left-by-claudeAgent" } : undefined,
          });
          yield* w.boot;
          const wire = yield* wireOf(w);
          const picked = yield* wire.assignAgent(
            {
              protocol,
              conversationId: mate,
              commandId: CommandId.make("agent-second"),
              instanceId: "claudeAgent:second",
              model: "m1",
            },
            ana,
          );
          assert.strictEqual(picked._tag, "Accepted");
          yield* send(wire, "Deploy the api");
          yield* w.settle;
          assert.deepInclude(w.provider.starts.at(-1), {
            resumeCursor: { session: "left-by-claudeAgent" },
          });
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "an agent picked before the conversation starts becomes its agent, on the driver its instance names",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          const result = yield* wire.assignAgent(
            {
              protocol,
              conversationId: mate,
              commandId: CommandId.make("agent-1"),
              instanceId: "codex:work",
              model: "gpt-5.4",
            },
            ana,
          );
          assert.strictEqual(result._tag, "Accepted");
          const frames = yield* watch(w, wire);
          const snapshot = frames.find((frame) => frame.type === "snapshot");
          assert.deepInclude(snapshot?.type === "snapshot" ? snapshot.header.agent : null, {
            instanceId: "codex:work",
            driver: "codex",
            model: "gpt-5.4",
          });
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "after the conversation started, an agent on another driver is refused in V1's words; one whose sessions resume the old one's is taken",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          yield* send(wire, "Deploy the api");
          const pick = (instanceId: string) =>
            wire.assignAgent(
              {
                protocol,
                conversationId: mate,
                commandId: CommandId.make(`agent-${instanceId}`),
                instanceId,
                model: "m1",
              },
              ana,
            );
          assert.deepStrictEqual(yield* pick("codex"), {
            _tag: "Rejected",
            rejection: {
              reason: "agent-locked",
              detail:
                "This conversation is bound to driver 'claudeAgent' and cannot switch to 'codex'.",
            },
          });
          const elsewhere = yield* pick("claudeAgent:other~another-home");
          assert.strictEqual(
            elsewhere._tag === "Rejected" && elsewhere.rejection.reason,
            "agent-locked",
          );
          assert.strictEqual((yield* pick("claudeAgent:second"))._tag, "Accepted");
          const unknown = yield* pick("nobody");
          assert.strictEqual(unknown._tag === "Rejected" && unknown.rejection.reason, "unknown");
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a repeated send with the same command id returns the stored result", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        const first = yield* send(wire, "Hello", "client-op-1");
        yield* w.settle;
        const again = yield* send(wire, "Hello", "client-op-1");
        assert.deepStrictEqual(again, first);
        const persons = (yield* w.items(runId(mate, 1))).filter((item) => item.kind === "person");
        assert.strictEqual(persons.length, 1, "the message is in the record once");
        assert.strictEqual((yield* w.runs).length, 1);
        const receipt = yield* wire.receipt({
          protocol,
          conversationId: mate,
          commandId: CommandId.make("client-op-1"),
        });
        assert.deepStrictEqual(receipt, { _tag: "Found", result: first } as typeof receipt);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("a refusal by the engine's rules is the call's answer, never a failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        const result = yield* send(wire, "   ");
        assert.strictEqual(result._tag, "Rejected");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "an answer's pictures reach the agent with its words, and the question's record keeps both",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          yield* send(wire, "Look at the preview");
          yield* w.settle;
          const asked = yield* w.agent((agent, thread) => agent.ask(thread, "question"));
          const [request] = yield* w.requests;
          const given = {
            answers: { target: "Inspect the preview shown here" },
            attachmentsByQuestionId: { target: [preview] },
          };
          const result = yield* wire.answer(
            {
              protocol,
              conversationId: mate,
              commandId: CommandId.make("answer-1"),
              requestId: RequestId.make(request!.request_id),
              answer: { kind: "input", ...given },
              summary: "Answered",
            },
            ana,
          );
          assert.strictEqual(result._tag, "Accepted");
          yield* w.settle;
          assert.include(w.provider.calls, `answer ${asked} with target: question-preview.png`);
          const [snapshot] = yield* watch(w, wire);
          assert.strictEqual(snapshot?.type, "snapshot");
          if (snapshot?.type !== "snapshot") return;
          assert.deepInclude(snapshot.requests[0]?.answer, given);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect(
    "a dismissal closes a question asked by message unanswered; the agent is not told",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          yield* send(wire, "Look at the preview");
          yield* w.settle;
          yield* w.agent((agent, thread) => agent.ask(thread, "message-question"));
          const [request] = yield* w.requests;
          const calls = w.provider.calls.length;
          const dismiss = (commandId: string) =>
            wire.dismiss(
              {
                protocol,
                conversationId: mate,
                commandId: CommandId.make(commandId),
                requestId: RequestId.make(request!.request_id),
              },
              ana,
            );
          assert.strictEqual((yield* dismiss("dismiss-1"))._tag, "Accepted");
          yield* w.settle;
          assert.strictEqual((yield* w.requests)[0]?.state, "dismissed");
          assert.strictEqual(w.provider.calls.length, calls, "nothing reached the agent");
          const again = yield* dismiss("dismiss-2");
          assert.deepStrictEqual(again, {
            _tag: "Rejected",
            rejection: { reason: "unknown-request" },
          } as typeof again);
          yield* w.shutdown;
        }),
      ),
  );

  it.effect("a question the agent waits on is refused a dismissal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const wire = yield* wireOf(w);
        yield* send(wire, "Look at the preview");
        yield* w.settle;
        yield* w.agent((agent, thread) => agent.ask(thread, "question"));
        const [request] = yield* w.requests;
        const result = yield* wire.dismiss(
          {
            protocol,
            conversationId: mate,
            commandId: CommandId.make("dismiss-1"),
            requestId: RequestId.make(request!.request_id),
          },
          ana,
        );
        assert.deepStrictEqual(result, {
          _tag: "Rejected",
          rejection: { reason: "not-dismissible" },
        } as typeof result);
        assert.strictEqual((yield* w.requests)[0]?.state, "open");
        yield* w.shutdown;
      }),
    ),
  );

  it.effect(
    "a client speaking a protocol this Mate does not serve is routed to reload or update",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const w = yield* world;
          const wire = yield* wireOf(w);
          const frames = yield* watch(w, wire, { protocol: 0 });
          assert.deepStrictEqual(frames, [
            {
              type: "unserved",
              reason: "protocol",
              protocols: [...MATE_ENGINE_PROTOCOLS],
              message:
                "This Mate speaks a newer conversation protocol. Reload or update this app to keep talking to it.",
            },
          ]);
          const sent = yield* wire.send(
            { protocol: 0, conversationId: mate, commandId: CommandId.make("old"), text: "Hi" },
            ana,
          );
          assert.strictEqual(sent._tag, "Unserved");
          assert.deepStrictEqual(yield* w.runs, [], "nothing reached the engine");
          yield* w.shutdown;
        }),
      ),
  );
});

/** The server's claim of a call's pictures, on a fresh attachments directory. */
const serverPictures = Effect.gen(function* () {
  const pictures = yield* MessagePictures;
  const config = yield* ServerConfig;
  return { pictures, attachmentsDir: config.attachmentsDir };
}).pipe(
  Effect.provide(
    serverMessagePictures.pipe(
      Layer.provideMerge(
        ServerConfigModule.layerTest(process.cwd(), { prefix: "engine-pictures-" }),
      ),
      Layer.provide(NodeServices.layer),
    ),
  ),
);

/** A picture the client uploaded and has not sent yet. */
const pendingPicture = (attachmentsDir: string, sizeBytes?: number): ChatImageAttachment => {
  const bytes = Buffer.from(PIXEL, "base64");
  const attachment = {
    type: "image",
    id: createPendingAttachmentId(".png"),
    name: "preview.png",
    mimeType: "image/png",
    sizeBytes: sizeBytes ?? bytes.length,
  } as ChatImageAttachment;
  const path = resolveAttachmentPath({ attachmentsDir, attachment })!;
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, bytes);
  return attachment;
};

const stored = (attachmentsDir: string, attachment: ChatAttachment) =>
  NodeFS.existsSync(resolveAttachmentPath({ attachmentsDir, attachment })!);

describe("the pictures a person sends an engine Mate", () => {
  // Catches the engine recording a reference to the pending upload the client deletes once the
  // send is answered: the driver's send then finds no picture.
  it.effect("reach the driver's send after the client let its pending upload go", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const { pictures, attachmentsDir } = yield* serverPictures;
        const wire = yield* wireOf(w, { pictures });
        const upload = pendingPicture(attachmentsDir);
        const result = yield* wire.send(
          {
            protocol,
            conversationId: mate,
            commandId: CommandId.make("send-picture"),
            text: "Look",
            attachments: [upload],
          },
          ana,
        );
        assert.strictEqual(result._tag, "Accepted");
        NodeFS.rmSync(resolveAttachmentPath({ attachmentsDir, attachment: upload })!);
        yield* w.settle;
        const [sent] = yield* w.within(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) =>
              sql<{ readonly payload_json: string }>`
                SELECT payload_json FROM engine_effect WHERE kind = 'provider.send'
              `,
          ),
        );
        const [picture] = (
          JSON.parse(sent!.payload_json) as { attachments: ReadonlyArray<ChatAttachment> }
        ).attachments;
        assert.notStrictEqual(picture?.id, upload.id);
        assert.isTrue(stored(attachmentsDir, picture!));
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("refuse a send whose picture is over V1's limit, in its words, recording nothing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const { pictures, attachmentsDir } = yield* serverPictures;
        const wire = yield* wireOf(w, { pictures });
        const result = yield* wire.send(
          {
            protocol,
            conversationId: mate,
            commandId: CommandId.make("send-huge"),
            text: "Look",
            attachments: [pendingPicture(attachmentsDir, 64 * 1024 * 1024)],
          },
          ana,
        );
        assert.strictEqual(result._tag, "Rejected");
        if (result._tag !== "Rejected") return;
        assert.strictEqual(result.rejection.reason, "attachment-refused");
        assert.isTrue((result.rejection.detail ?? "").length > 0);
        const runs = yield* w.within(
          Effect.flatMap(SqlClient.SqlClient, (sql) => sql`SELECT run_id FROM engine_run`),
        );
        assert.deepStrictEqual(runs, []);
        yield* w.shutdown;
      }),
    ),
  );

  it.effect("on an answer are claimed the same way, each to its question", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const w = yield* world;
        const { pictures, attachmentsDir } = yield* serverPictures;
        const wire = yield* wireOf(w, { pictures });
        yield* send(wire, "Look at the preview");
        yield* w.settle;
        yield* w.agent((agent, thread) => agent.ask(thread, "question"));
        const [request] = yield* w.requests;
        const upload = pendingPicture(attachmentsDir);
        const result = yield* wire.answer(
          {
            protocol,
            conversationId: mate,
            commandId: CommandId.make("answer-picture"),
            requestId: RequestId.make(request!.request_id),
            answer: {
              kind: "input",
              answers: { target: "This one" },
              attachmentsByQuestionId: { target: [upload] },
            },
            summary: "Answered",
          },
          ana,
        );
        assert.strictEqual(result._tag, "Accepted");
        NodeFS.rmSync(resolveAttachmentPath({ attachmentsDir, attachment: upload })!);
        yield* w.settle;
        const [snapshot] = yield* watch(w, wire);
        if (snapshot?.type !== "snapshot") return assert.fail("no snapshot");
        const answered = snapshot.requests[0]?.answer as
          | { readonly attachmentsByQuestionId?: Record<string, ReadonlyArray<ChatAttachment>> }
          | undefined;
        const [picture] = answered?.attachmentsByQuestionId?.target ?? [];
        assert.notStrictEqual(picture?.id, upload.id);
        assert.isTrue(stored(attachmentsDir, picture!));
        yield* w.shutdown;
      }),
    ),
  );
});

describe("a Mate whose conversation is on V1", () => {
  it.effect("does not serve the engine's wire: every method answers unserved", () =>
    Effect.gen(function* () {
      const frames = yield* Stream.runCollect(
        unservedWire.subscribe({ protocol, conversationId: mate }, ana),
      );
      assert.deepStrictEqual(Array.from(frames), [
        { type: "unserved", reason: "not-on-engine", protocols: [], message: NOT_ON_ENGINE },
      ]);
      const sent = yield* unservedWire.send(
        { protocol, conversationId: mate, commandId: CommandId.make("c"), text: "Hi" },
        ana,
      );
      assert.strictEqual(sent._tag, "Unserved");
    }),
  );
});
