import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  EngineCallResult,
  EngineConversationFrame,
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
