import { expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { serve, deadline } from "../../harness/http.ts";
import { outageConnection } from "./connection.ts";

const nextFrame = (socket: WebSocket) =>
  deadline(
    new Promise<Record<string, unknown>>((resolve) =>
      socket.once("message", (raw) => resolve(JSON.parse(String(raw)) as Record<string, unknown>)),
    ),
    "outage driver frame",
  );

it("forwards HTTP and corrupts exactly one entry of a real upstream snapshot", async () => {
  const original = {
    type: "snapshot",
    apps: [{ name: "Shop" }],
    mates: {
      Ada: { task: "Ada task" },
      Bea: { task: "Bea task" },
    },
  };
  const upstream = await serve(
    () => ({ status: 201, body: { fromCore: true } }),
    (socket) => socket.send(JSON.stringify(original)),
  );
  const proxy = await outageConnection(upstream.origin);
  const socket = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/api/structure/ws`);
  try {
    expect(await nextFrame(socket)).toEqual(original);
    const response = await fetch(`${proxy.origin}/api/future`);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ fromCore: true });
    const corrupt = nextFrame(socket);
    proxy.corruptMate("Ada");
    expect(await corrupt).toEqual({
      ...original,
      mates: {
        Ada: { presence: "corrupt" },
        Bea: original.mates.Bea,
      },
    });
  } finally {
    socket.terminate();
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
