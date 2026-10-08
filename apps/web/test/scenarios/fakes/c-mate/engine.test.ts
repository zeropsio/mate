import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  EngineCallResult,
  EngineConversationFrame,
  EngineDetail,
  EnginePage,
  EngineReceiptResult,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
} from "@t3tools/contracts";
import { WebSocket } from "ws";

import { MateFake } from "../mate.ts";
import { ChatDriver } from "../../areas/c-mate/fake.ts";
import { EngineChatWire } from "../../areas/c-mate/engine.ts";
import { deadline, serve } from "../../harness/http.ts";

const decodeFrame = Schema.decodeUnknownSync(EngineConversationFrame);
const decodeCall = Schema.decodeUnknownSync(EngineCallResult);
const decodeReceipt = Schema.decodeUnknownSync(EngineReceiptResult);
const decodeDetail = Schema.decodeUnknownSync(EngineDetail);

interface Frame {
  readonly _tag: string;
  readonly requestId: string;
  readonly values?: unknown[];
  readonly exit?: { readonly _tag: string; readonly value?: unknown };
}

async function connect() {
  const mate = new MateFake("Ada", "Ada");
  const wire = new EngineChatWire(mate);
  const chat = new ChatDriver(mate, wire);
  wire.install();
  const server = await serve(mate.handle, mate.socket);
  const socket = new WebSocket(server.origin.replace("http:", "ws:") + "/ws");
  const frames: Frame[] = [];
  let notify = () => {};
  socket.on("message", (raw) => {
    frames.push(JSON.parse(String(raw)) as Frame);
    notify();
  });
  await deadline(
    new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    "engine socket",
  );
  const until = async (predicate: () => boolean) => {
    while (!predicate())
      await deadline(
        new Promise<void>((resolve) => {
          notify = resolve;
        }),
        "engine wire frame",
        5000,
      );
  };
  const request = (id: string, tag: string, payload: Record<string, unknown>) =>
    socket.send(JSON.stringify({ _tag: "Request", id, tag, payload }));
  const call = async (id: string, tag: string, payload: Record<string, unknown>) => {
    request(id, tag, payload);
    await until(() => frames.some((frame) => frame._tag === "Exit" && frame.requestId === id));
    return frames.find((frame) => frame._tag === "Exit" && frame.requestId === id)!.exit!;
  };
  const stream = (id: string) =>
    frames
      .filter((frame) => frame.requestId === id)
      .flatMap((frame) => frame.values ?? [])
      .map((value) => decodeFrame(value));
  return {
    mate,
    wire,
    chat,
    request,
    call,
    stream,
    until,
    close: async () => {
      socket.terminate();
      await server.close();
    },
  };
}

const conversation = { protocol: 1, conversationId: "thread-Ada" };

// Catches an engine fake a client reads by V1's shape instead of the contract's frames.
it("advertises the engine and opens its conversation on contract frames", async () => {
  const r = await connect();
  try {
    expect(r.mate.descriptor.capabilities.mateEngine).toEqual({ protocol: 1 });
    r.wire.history("The existing conversation is still here");
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    await r.until(() => r.stream("c").some((frame) => frame.type === "synchronized"));
    const [snapshot] = r.stream("c");
    expect(snapshot).toMatchObject({
      type: "snapshot",
      header: { agent: { instanceId: "codex" } },
      items: [{ kind: "person", text: "The existing conversation is still here" }],
    });
  } finally {
    await r.close();
  }
});

// Catches a pending bubble doubling because the item's send id is not the command the client sent.
it("gives a sent message's item the send's command id, and applies a repeated id once", async () => {
  const r = await connect();
  try {
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    const send = { ...conversation, commandId: "message-7", text: "And the worker" };
    const first = decodeCall((await r.call("s1", WS_METHODS.engineSend, send)).value);
    const again = decodeCall((await r.call("s2", WS_METHODS.engineSend, send)).value);
    expect(again).toEqual(first);
    await r.until(() =>
      r
        .stream("c")
        .some(
          (frame) => frame.type === "changes" && frame.runs.some((run) => run.state === "running"),
        ),
    );
    const item = r
      .stream("c")
      .flatMap((frame) => (frame.type === "changes" ? frame.items : []))
      .find((entry) => entry.kind === "person");
    expect(item).toMatchObject({ sendId: "message-7", text: "And the worker" });
    expect(r.wire.intents()).toEqual([{ kind: "turn", text: "And the worker" }]);
    const receipt = decodeReceipt(
      (await r.call("q", WS_METHODS.engineReceipt, { ...conversation, commandId: "message-7" }))
        .value,
    );
    expect(receipt).toEqual({ _tag: "Found", result: first });
  } finally {
    await r.close();
  }
});

// Catches a resume that re-sends the whole conversation or misses a change made while away.
it("resumes a cursor with only what changed after it", async () => {
  const r = await connect();
  try {
    r.wire.history("Earlier words");
    const head = r.wire.engine.seq;
    r.wire.approval();
    r.request("c", WS_METHODS.subscribeEngineConversation, {
      ...conversation,
      after: { epoch: 1, origin: r.wire.engine.origin, seq: head },
    });
    await r.until(() => r.stream("c").some((frame) => frame.type === "synchronized"));
    const [changes] = r.stream("c");
    expect(changes).toMatchObject({ type: "changes", from: head, requests: [{ state: "open" }] });
    expect(
      changes?.type === "changes" && changes.items.some((item) => item.kind === "person"),
    ).toBe(false);
  } finally {
    await r.close();
  }
});

// Catches a client that still writes V1 commands to a Mate whose conversation moved to the engine.
it("refuses and flags a V1 turn sent to an engine conversation", async () => {
  const r = await connect();
  try {
    const exit = await r.call("v1", ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "thread.turn.start",
      commandId: "c-1",
      threadId: "thread-Ada",
      message: { messageId: "m-1", role: "user", text: "Hi", attachments: [] },
      createdAt: "2026-10-05T12:00:00.000Z",
    });
    expect(exit._tag).toBe("Failure");
    expect([...r.mate.unknownMethods].join()).toMatch(/V1 write to an engine conversation/);
    expect(r.wire.intents()).toEqual([]);
  } finally {
    await r.close();
  }
});

// Catches a client that still sends any V1 command (a title, a model, a mode) to an engine Mate.
it("refuses and flags every V1 command sent to an engine conversation, as the server does", async () => {
  const r = await connect();
  try {
    const exit = await r.call("meta", ORCHESTRATION_WS_METHODS.dispatchCommand, {
      type: "thread.meta.update",
      commandId: "c-2",
      threadId: "thread-Ada",
      title: "Deploy the api",
    });
    expect(exit._tag).toBe("Failure");
    expect([...r.mate.unknownMethods].join()).toMatch(/thread\.meta\.update/);
  } finally {
    await r.close();
  }
});

// Catches a model change on an engine Mate going anywhere but the engine's model switch.
it("switches the conversation's model and sends the new header", async () => {
  const r = await connect();
  try {
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    const switched = decodeCall(
      (
        await r.call("m", WS_METHODS.engineSwitchModel, {
          ...conversation,
          commandId: "switch-1",
          model: "gpt-5.5",
        })
      ).value,
    );
    expect(switched._tag).toBe("Accepted");
    await r.until(() =>
      r.stream("c").some((frame) => frame.type === "changes" && frame.header?.model === "gpt-5.5"),
    );
  } finally {
    await r.close();
  }
});

// Catches an engine fake whose settings a client cannot see take, or that lets a started
// conversation move to another driver.
it("applies a model's options, a runtime mode and an agent pick, and refuses another driver once the conversation ran", async () => {
  const r = await connect();
  try {
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    const call = async (id: string, tag: string, payload: Record<string, unknown>) =>
      decodeCall((await r.call(id, tag, { ...conversation, commandId: id, ...payload })).value);
    const effort = [{ id: "reasoningEffort", value: "high" }];
    expect(
      (await call("o", WS_METHODS.engineSwitchModel, { model: "gpt-5.4", options: effort }))._tag,
    ).toBe("Accepted");
    expect(
      (await call("m", WS_METHODS.engineSetRuntimeMode, { runtimeMode: "approval-required" }))._tag,
    ).toBe("Accepted");
    await r.until(() =>
      r
        .stream("c")
        .some(
          (frame) =>
            frame.type === "changes" &&
            frame.header?.runtimeMode === "approval-required" &&
            JSON.stringify(frame.header.agent?.options) === JSON.stringify(effort),
        ),
    );
    expect(
      (await call("a", WS_METHODS.engineAssignAgent, { instanceId: "claudeAgent", model: "opus" }))
        ._tag,
    ).toBe("Accepted");
    r.wire.engine.personTurn("Deploy the api");
    const refused = await call("b", WS_METHODS.engineAssignAgent, {
      instanceId: "codex",
      model: "gpt-5.4",
    });
    expect(refused._tag === "Rejected" && refused.rejection.reason).toBe("agent-locked");
  } finally {
    await r.close();
  }
});

const decodePage = Schema.decodeUnknownSync(EnginePage);

// Catches a fake that hands the client every record at once, so paging is never exercised.
it("opens on a window of the newest run groups, the rest a page away", async () => {
  const r = await connect();
  try {
    const engine = r.wire.engine;
    engine.windowGroups = 1;
    engine.runPageItems = 1;
    r.wire.history("Earlier words");
    const run = engine.personRun("Deploy the api");
    engine.item(run, {
      kind: "call",
      step: "command",
      tool: { name: "Bash" },
      words: "Ran command",
      state: "done",
      endedAt: null,
    });
    const answer = engine.item(run, {
      kind: "note",
      text: "Deployed.",
      streaming: false,
      answer: true,
    });
    engine.end(run, { kind: "completed" }, answer);
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    await r.until(() => r.stream("c").some((frame) => frame.type === "synchronized"));
    const [snapshot] = r.stream("c");
    expect(snapshot).toMatchObject({
      type: "snapshot",
      runs: [{ ordinal: 2, summary: { items: 3 } }],
      window: { oldestOrdinal: 2, earlier: true },
    });
    expect(snapshot?.type === "snapshot" && snapshot.items.map((item) => item.kind)).toEqual([
      "person",
      "note",
    ]);
    const newest = decodePage(
      (await r.call("p1", WS_METHODS.engineReadRun, { ...conversation, runId: run })).value,
    );
    expect(newest).toMatchObject({ items: [{ kind: "note" }], more: true });
    const older = decodePage(
      (
        await r.call("p2", WS_METHODS.engineReadRun, {
          ...conversation,
          runId: run,
          beforeSeq: newest._tag === "Page" ? newest.items[0]!.seq : 0,
        })
      ).value,
    );
    expect(older).toMatchObject({ items: [{ kind: "call" }], more: true });
    const earlier = decodePage(
      (await r.call("e", WS_METHODS.engineReadEarlier, { ...conversation, beforeOrdinal: 2 }))
        .value,
    );
    expect(earlier).toMatchObject({
      runs: [{ ordinal: 1 }],
      items: [{ kind: "person", text: "Earlier words" }],
      window: { oldestOrdinal: 1, earlier: false },
    });
  } finally {
    await r.close();
  }
});

// Catches streamed text a late subscriber never hears, or one placed at the wrong offset.
it("streams an item's text at its offsets, whole to a subscriber that opens late", async () => {
  const r = await connect();
  try {
    const engine = r.wire.engine;
    const run = engine.personRun("Deploy the api");
    const note = engine.item(run, { kind: "note", text: "", streaming: true, answer: false });
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    await r.until(() => r.stream("c").some((frame) => frame.type === "synchronized"));
    engine.stream(note, "Deploying ");
    engine.stream(note, "the api");
    r.request("late", WS_METHODS.subscribeEngineConversation, conversation);
    await r.until(() => r.stream("late").some((frame) => frame.type === "live.open"));
    engine.settle(note);
    await r.until(() => r.stream("c").some((frame) => frame.type === "live.settle"));
    expect(r.stream("c").filter((frame) => frame.type.startsWith("live."))).toEqual([
      { type: "live.open", itemId: note, stream: "text", text: "Deploying " },
      { type: "live.append", itemId: note, stream: "text", offset: 10, text: "the api" },
      { type: "live.settle", itemId: note },
    ]);
    expect(r.stream("late").find((frame) => frame.type === "live.open")).toEqual({
      type: "live.open",
      itemId: note,
      stream: "text",
      text: "Deploying the api",
    });
  } finally {
    await r.close();
  }
});

const preview = {
  type: "image",
  id: "img-1",
  name: "question-preview.png",
  mimeType: "image/png",
  sizeBytes: 2048,
};

// Catches an engine fake that drops an answer's pictures, so a journey cannot see them arrive.
it("applies an answer with the pictures attached to each question, and its record keeps them", async () => {
  const r = await connect();
  try {
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    r.chat.run("question-custom-run", "running");
    r.chat.question("question-custom", "question-custom-run");
    const [asked] = r.wire.engine.requests.values();
    const given = {
      answers: { target: "Inspect the preview shown here" },
      attachmentsByQuestionId: { target: [preview] },
    };
    const exit = await r.call("a", WS_METHODS.engineAnswer, {
      ...conversation,
      commandId: "answer-1",
      requestId: asked!.id,
      answer: { kind: "input", ...given },
      summary: "Answered",
    });
    expect(decodeCall(exit.value)).toMatchObject({
      _tag: "Accepted",
      requestId: asked!.id,
    });
    expect(await r.chat.waitForAnswer("question-custom")).toMatchObject({
      requestId: "question-custom",
      ...given,
    });
    await r.until(() =>
      r
        .stream("c")
        .some(
          (frame) =>
            frame.type === "changes" &&
            frame.requests.some((request) => request.state === "answered"),
        ),
    );
    const answered = r
      .stream("c")
      .flatMap((frame) => (frame.type === "changes" ? frame.requests : []))
      .findLast((request) => request.id === asked!.id);
    expect(answered).toMatchObject({ runId: asked!.runId, answer: given });
    expect(r.wire.engine.runs.get(asked!.runId)?.state).toBe("running");
  } finally {
    await r.close();
  }
});

// Catches an engine fake that lets a person dismiss a question its agent waits on.
it("dismisses a question asked by message, and refuses one its agent waits on", async () => {
  const r = await connect();
  try {
    const asked = r.wire.engine.ask({ kind: "question", questions: [], dismissible: true });
    const waits = r.wire.engine.ask({ kind: "question", questions: [], dismissible: false });
    const dismiss = async (id: string, requestId: string) =>
      decodeCall(
        (await r.call(id, WS_METHODS.engineDismiss, { ...conversation, commandId: id, requestId }))
          .value,
      );
    expect(await dismiss("d1", asked)).toMatchObject({ _tag: "Accepted", requestId: asked });
    expect(r.wire.engine.requests.get(asked)?.state).toBe("dismissed");
    expect(await dismiss("d2", waits)).toEqual({
      _tag: "Rejected",
      rejection: { reason: "not-dismissible" },
    });
    expect(r.wire.engine.applied.map(({ op, payload }) => [op, payload.requestId])).toEqual([
      ["dismiss", asked],
    ]);
  } finally {
    await r.close();
  }
});

// Catches an engine fake whose refusal never reaches the client the way the Mate's own does.
it("refuses an answer for want of authority in the area's words, applying nothing", async () => {
  const r = await connect();
  try {
    r.chat.question("question-custom");
    const [asked] = r.wire.engine.requests.values();
    r.chat.responseRefusal = "Your answer was refused. Sign in and retry.";
    const exit = await r.call("a", WS_METHODS.engineAnswer, {
      ...conversation,
      commandId: "answer-1",
      requestId: asked!.id,
      answer: { kind: "input", answers: { target: "stage" } },
      summary: "Answered",
    });
    expect(exit).toMatchObject({
      _tag: "Failure",
      cause: [
        {
          error: {
            _tag: "EnvironmentAuthorizationError",
            message: "Your answer was refused. Sign in and retry.",
          },
        },
      ],
    });
    expect(r.wire.intents()).toEqual([]);
  } finally {
    await r.close();
  }
});

// Catches a call served without what its row shows, or a long result served half.
it("serves a call's line, facts and result, a long result cut and read whole, its output on demand", async () => {
  const r = await connect();
  try {
    const engine = r.wire.engine;
    const run = engine.personRun("Deploy the api");
    const deployed = `{"status":"DEPLOYED","buildLogs":"${"ok ".repeat(6_000)}"}`;
    const call = engine.item(run, {
      kind: "call",
      step: "mcp",
      tool: { name: "zerops_deploy", server: "zerops" },
      words: "MCP tool call",
      state: "done",
      endedAt: null,
      input: 'mcp__zerops__zerops_deploy: {"targetService":"api"}',
      shows: { toolName: "mcp__zerops__zerops_deploy", input: { targetService: "api" } },
      result: { toolName: "zerops_deploy", resultText: deployed },
      parts: ["detail"],
    });
    engine.detail(call, "detail", "Deploying api…\nDeployed.");
    r.request("c", WS_METHODS.subscribeEngineConversation, conversation);
    await r.until(() => r.stream("c").some((frame) => frame.type === "synchronized"));
    const [snapshot] = r.stream("c");
    expect(snapshot?.type === "snapshot" && snapshot.items.at(-1)).toMatchObject({
      input: 'mcp__zerops__zerops_deploy: {"targetService":"api"}',
      shows: { toolName: "mcp__zerops__zerops_deploy" },
      result: { toolName: "zerops_deploy" },
      cut: { part: "result", total: deployed.length },
    });
    const part = async (id: string, name: string) =>
      decodeDetail(
        (
          await r.call(id, WS_METHODS.engineReadDetail, {
            ...conversation,
            itemId: call,
            part: name,
          })
        ).value,
      );
    expect(await part("r", "result")).toMatchObject({ _tag: "Detail", text: deployed });
    expect(await part("o", "detail")).toMatchObject({
      _tag: "Detail",
      text: "Deploying api…\nDeployed.",
    });
    expect(await part("d", "data")).toEqual({ _tag: "Missing" });
  } finally {
    await r.close();
  }
});
