import { it, expect } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  ExecutionEnvironmentDescriptor,
  MateAttention,
  OrchestrationThreadStreamItem,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
} from "@t3tools/contracts";
import { WebSocket } from "ws";
import { MateFake } from "./mate.ts";
import { serve, deadline } from "../harness/http.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
const decodeItem = Schema.decodeUnknownSync(OrchestrationThreadStreamItem);

async function connect(origin: string) {
  const socket = new WebSocket(origin.replace("http:", "ws:") + "/ws");
  const queue: { _tag: string; values: unknown[] }[] = [];
  let ready = () => {};
  socket.on("message", (raw) => {
    queue.push(JSON.parse(raw.toString()));
    ready();
  });
  await deadline(
    new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    }),
    "Mate socket open",
  );
  return {
    subscribe(afterSequence?: number) {
      socket.send(
        JSON.stringify({
          _tag: "Request",
          id: "detail",
          tag: ORCHESTRATION_WS_METHODS.subscribeThread,
          payload: {
            threadId: "thread-Ada",
            ...(afterSequence === undefined ? {} : { afterSequence }),
          },
        }),
      );
    },
    async next() {
      if (!queue.length)
        await deadline(
          new Promise<void>((resolve) => {
            ready = resolve;
          }),
          "Mate stream chunk",
        );
      const frame = queue.shift()!;
      expect(frame._tag).toBe("Chunk");
      return frame.values.map((value) => decodeItem(value));
    },
    async close() {
      await deadline(
        new Promise<void>((resolve) => {
          socket.once("close", () => resolve());
          socket.close();
        }),
        "Mate socket close",
      );
    },
  };
}

it("serves today's typed descriptor and replays only events newer than afterSequence after reconnect", async () => {
  const fake = new MateFake("Ada", "Ada");
  const server = await serve(fake.handle, fake.socket);
  try {
    const descriptor = decodeDescriptor(
      await (await fetch(server.origin + "/.well-known/t3/environment")).json(),
    );
    expect(descriptor.zerops?.projectId).toBe("Ada");
    const first = await connect(server.origin);
    first.subscribe();
    expect((await first.next()).map((item) => item.kind)).toEqual(["snapshot", "synchronized"]);
    fake.message("one", "Before disconnect", "command-one");
    expect(await first.next()).toMatchObject([
      { kind: "event", event: { sequence: 2, type: "thread.message-sent" } },
    ]);
    await first.close();
    fake.message("two", "During disconnect", "command-two");
    const second = await connect(server.origin);
    second.subscribe(2);
    expect(await second.next()).toMatchObject([
      { kind: "event", event: { sequence: 3, payload: { text: "During disconnect" } } },
      { kind: "synchronized" },
    ]);
    const serverClosed = Promise.all(
      [...fake.subscriptions.keys()].map(
        (socket) => new Promise<void>((resolve) => socket.once("close", () => resolve())),
      ),
    );
    await second.close();
    await deadline(serverClosed, "server observed socket close");
    expect(fake.subscriptions.size).toBe(0);
  } finally {
    await server.close();
  }
});

it("publishes its attention: whole on subscribe, then each new revision, a message one too", async () => {
  const fake = new MateFake("Ada", "Ada");
  const server = await serve(fake.handle, fake.socket);
  const decode = Schema.decodeUnknownSync(MateAttention);
  try {
    const socket = new WebSocket(server.origin.replace("http:", "ws:") + "/ws");
    const frames: unknown[][] = [];
    let ready = () => {};
    socket.on("message", (raw) => {
      frames.push((JSON.parse(raw.toString()) as { values: unknown[] }).values);
      ready();
    });
    await deadline(new Promise((resolve) => socket.once("open", resolve)), "Mate socket open");
    const next = async () => {
      if (frames.length === 0)
        await deadline(new Promise<void>((resolve) => (ready = resolve)), "attention chunk");
      return decode(frames.shift()![0]);
    };
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: "attention",
        tag: WS_METHODS.subscribeZeropsAttention,
        payload: {},
      }),
    );
    expect(await next()).toMatchObject({
      source: { epoch: 1, incarnation: "fake-Ada", revision: 0 },
      mainThreadId: "thread-Ada",
      working: 0,
    });
    fake.publishAttention({ working: 1 });
    expect(await next()).toMatchObject({ source: { revision: 1 }, working: 1 });
    fake.message("one", "Hello", "command-one");
    expect(await next()).toMatchObject({ source: { revision: 2 }, working: 1 });
    socket.close();
  } finally {
    await server.close();
  }
});

it("revises its attention for its link to HQ alone, and starts it over when it restarts", () => {
  const fake = new MateFake("Ada", "Ada");
  fake.publishAttention({ working: 1 });
  expect(fake.reviseAttention({ working: 0 })).toMatchObject({
    source: { epoch: 1, incarnation: "fake-Ada", revision: 2 },
    working: 0,
  });
  fake.restart();
  expect(fake.attention()).toMatchObject({
    source: { epoch: 2, incarnation: "fake-Ada:1", revision: 0 },
    working: 0,
  });
  expect(fake.publishAttention()).toMatchObject({
    source: { epoch: 2, incarnation: "fake-Ada:1", revision: 1 },
  });
});
