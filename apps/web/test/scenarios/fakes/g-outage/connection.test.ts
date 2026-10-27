import { expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { serve, deadline } from "../../harness/http.ts";
import { outageConnection } from "./connection.ts";
import { HQ_STREAM_SEGMENT_CLOSE } from "@t3tools/shared/hqStream";

const nextFrame = (socket: WebSocket) =>
  deadline(
    new Promise<Record<string, unknown>>((resolve) =>
      socket.once("message", (raw) => resolve(JSON.parse(String(raw)) as Record<string, unknown>)),
    ),
    "outage driver frame",
  );

it("forwards HTTP and corrupts the next delivery of one Mate's real attention", async () => {
  const delivered = {
    type: "scope-reset",
    scope: { kind: "attention", projectId: "Ada" },
    incarnation: "i1",
    revision: 4,
    values: [{ key: "Ada", value: { task: "Ada task" } }],
    removals: [],
  };
  const upstream = await serve(
    () => ({ status: 201, body: { fromCore: true } }),
    (socket) => socket.send(JSON.stringify(delivered)),
  );
  const proxy = await outageConnection(upstream.origin);
  const socket = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
  try {
    expect(await nextFrame(socket)).toEqual(delivered);
    const response = await fetch(`${proxy.origin}/api/future`);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ fromCore: true });
    const corrupt = nextFrame(socket);
    proxy.corruptMate("Ada");
    expect(await corrupt).toEqual({
      type: "scope-values",
      scope: { kind: "attention", projectId: "Ada" },
      incarnation: "i1",
      revision: 5,
      values: [{ key: "Ada", value: { presence: "corrupt" } }],
      removals: [],
    });
    expect(() => proxy.corruptMate("Bea")).toThrow(/Wait for HQ's real attention of Bea/u);
  } finally {
    socket.close();
    await proxy.close();
    await upstream.close();
  }
});

it("forwards non-JSON text and binary bytes unchanged in both directions", async () => {
  const upstream = await serve(
    () => ({ body: {} }),
    (socket) => {
      socket.on("message", (data, binary) => socket.send(data, { binary }));
    },
  );
  const proxy = await outageConnection(upstream.origin);
  const socket = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
  try {
    await deadline(new Promise<void>((resolve) => socket.once("open", resolve)), "raw client open");
    for (const [data, binary] of [
      [Buffer.from("not JSON"), false],
      [Buffer.from([0, 127, 255]), true],
    ] as const) {
      const received = deadline(
        new Promise<{ data: Buffer; binary: boolean }>((resolve) =>
          socket.once("message", (raw, binary) =>
            resolve({ data: Buffer.from(raw as Buffer), binary }),
          ),
        ),
        "raw frame echo",
      );
      socket.send(data, { binary });
      expect(await received).toEqual({ data, binary });
    }
  } finally {
    socket.terminate();
    await proxy.close();
    await upstream.close();
  }
});

it("stall keeps both sides open, blocks both directions and leaves the next socket unaffected", async () => {
  let upstreamSocket: WebSocket | undefined;
  let received = 0;
  const upstream = await serve(
    () => ({ body: {} }),
    (socket) => {
      upstreamSocket = socket;
      socket.send(JSON.stringify({ type: "snapshot", apps: [], mates: {} }));
      socket.on("message", (data, binary) => {
        received++;
        socket.send(data, { binary });
      });
    },
  );
  const proxy = await outageConnection(upstream.origin);
  const socket = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
  let next: WebSocket | undefined;
  try {
    await nextFrame(socket);
    const stalled = await proxy.stall();
    upstreamSocket!.send(JSON.stringify({ type: "change", name: "stalled rename" }));
    await stalled.waitForDownstream("stalled rename");
    socket.send(JSON.stringify({ type: "blocked input" }));
    await stalled.waitForUpstream();
    expect(received).toBe(0);
    expect(stalled.open).toBe(true);
    next = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
    expect(await nextFrame(next)).toMatchObject({ type: "snapshot" });
    const echo = nextFrame(next);
    next.send(JSON.stringify({ type: "new input" }));
    expect(await echo).toEqual({ type: "new input" });
    expect(stalled.open).toBe(true);
  } finally {
    socket.terminate();
    next?.terminate();
    await proxy.close();
    await upstream.close();
  }
});

it("segment rollover waits for a new socket, cuts its snapshot and exchanges acknowledged pings", async () => {
  const upstream = await serve(
    () => ({ body: {} }),
    (socket) => socket.send(JSON.stringify({ type: "snapshot", apps: [], mates: {} })),
  );
  const proxy = await outageConnection(upstream.origin);
  const socket = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
  let next: WebSocket | undefined;
  try {
    await nextFrame(socket);
    const closed = deadline(
      new Promise<number>((resolve) => socket.once("close", resolve)),
      "segment closed",
    );
    const rolled = proxy.nextSegmentWithoutSnapshot();
    expect(await closed).toBe(HQ_STREAM_SEGMENT_CLOSE.code);
    // ping waits for exactly one socket instead of rejecting during the rollover gap.
    const ping = proxy.ping();
    next = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
    const frames: string[] = [];
    next.on("message", (raw) => {
      frames.push(String(raw));
      if (JSON.parse(String(raw)).type === "ping") next!.send(JSON.stringify({ type: "pong" }));
    });
    await rolled;
    await ping;
    expect(frames).toEqual([JSON.stringify({ type: "ping" })]);
  } finally {
    socket.terminate();
    next?.terminate();
    await proxy.close();
    await upstream.close();
  }
});

it("fact loss suppresses upstream changes while acknowledged pings still flow", async () => {
  const upstream = await serve(
    () => ({ body: {} }),
    (socket) => {
      socket.send(JSON.stringify({ type: "snapshot", apps: [], mates: {} }));
      socket.on("message", (raw) => {
        if (JSON.parse(String(raw)).type === "change-request") {
          socket.send(JSON.stringify({ type: "change", key: "Shop", value: { name: "New" } }));
          socket.send(JSON.stringify({ type: "ping" }));
        }
      });
    },
  );
  const proxy = await outageConnection(upstream.origin);
  const socket = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
  try {
    await nextFrame(socket);
    proxy.silenceFacts();
    const received = nextFrame(socket);
    socket.send(JSON.stringify({ type: "change-request" }));
    expect(await received).toEqual({ type: "ping" });
    socket.on("message", (raw) => {
      if (JSON.parse(String(raw)).type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    });
    await proxy.ping();
  } finally {
    socket.terminate();
    await proxy.close();
    await upstream.close();
  }
});
