// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- loopback transport evidence.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { describe, expect, it } from "vite-plus/test";
import { transportGate } from "../harness/transportGate.ts";

const source = async () => {
  const bytes = Buffer.from([0, 255, 20, 0, 128]);
  const server = NodeHttp.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(bytes);
  });
  const ws = new WebSocketServer({ server });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`;
  const gate = await transportGate(() => origin);
  return {
    bytes,
    ws,
    gate,
    close: async () => {
      await gate.close();
      for (const peer of ws.clients) peer.terminate();
      ws.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
const connect = async (origin: string) => {
  const socket = new WebSocket(origin.replace("http:", "ws:") + "/mate/ws");
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};
describe("transparent scenario transport", () => {
  it("holds real HTTP asset bytes until release", async () => {
    const s = await source();
    try {
      const hold = s.gate.holdHttp((path) => path.includes("/api/chat-assets/"));
      let arrived = false;
      const answer = fetch(s.gate.origin + "/mate/api/chat-assets/proof").then(async (response) => {
        const bytes = Buffer.from(await response.arrayBuffer());
        arrived = true;
        return bytes;
      });
      await hold.held;
      expect(arrived).toBe(false);
      hold.release();
      expect(await answer).toEqual(s.bytes);
    } finally {
      await s.close();
    }
  });
  it("reorders and replays captured text and binary frames without rewriting bytes", async () => {
    const s = await source();
    try {
      const hold = s.gate.holdFrames(() => true);
      const connection = new Promise<WebSocket>((resolve) => s.ws.once("connection", resolve));
      const socket = await connect(s.gate.origin);
      const upstream = await connection;
      const received: Array<{ bytes: Buffer; binary: boolean }> = [];
      socket.on("message", (bytes, binary) =>
        received.push({ bytes: Buffer.from(bytes as Buffer), binary }),
      );
      upstream.send('{"epoch":1,"seq":2}');
      await hold.held;
      const second = hold.next();
      upstream.send(s.bytes);
      await second;
      const got = new Promise<void>((resolve) => socket.once("message", () => resolve()));
      hold.deliver(1);
      await got;
      const replayed = new Promise<void>((resolve) => socket.once("message", () => resolve()));
      hold.deliver(0);
      await replayed;
      const duplicated = new Promise<void>((resolve) => socket.once("message", () => resolve()));
      hold.replay(0);
      await duplicated;
      expect(received).toEqual([
        { bytes: s.bytes, binary: true },
        { bytes: Buffer.from('{"epoch":1,"seq":2}'), binary: false },
        { bytes: Buffer.from('{"epoch":1,"seq":2}'), binary: false },
      ]);
      hold.release();
      socket.terminate();
    } finally {
      await s.close();
    }
  });
  it("observes the Mate's RPC answer while its unchanged bytes are held", async () => {
    const s = await source();
    try {
      const connection = new Promise<WebSocket>((resolve) => s.ws.once("connection", resolve));
      const socket = await connect(s.gate.origin);
      const upstream = await connection;
      const answered = s.gate.answered((tag) => tag === "proof");
      const request = new Promise<void>((resolve) => upstream.once("message", () => resolve()));
      socket.send(JSON.stringify({ _tag: "Request", id: 7, tag: "proof" }));
      await request;
      const hold = s.gate.holdFrames(() => true);
      const exit = { _tag: "Exit", requestId: 7, exit: { _tag: "Success", value: "native" } };
      const bytes = JSON.stringify(exit);
      const delivered = new Promise<Buffer>((resolve) =>
        socket.once("message", (data) => resolve(Buffer.from(data as Buffer))),
      );
      upstream.send(bytes);
      expect(await answered).toEqual(exit);
      await hold.held;
      expect(hold.frames[0]?.bytes).toEqual(Buffer.from(bytes));
      hold.release();
      expect(await delivered).toEqual(Buffer.from(bytes));
      socket.terminate();
    } finally {
      await s.close();
    }
  });
  it("disconnects current clients and reconnects through the same gate", async () => {
    const s = await source();
    try {
      const socket = await connect(s.gate.origin);
      const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      s.gate.disconnect();
      await closed;
      expect((await fetch(s.gate.origin + "/mate/asset")).status).toBe(503);
      s.gate.reconnect();
      const next = await connect(s.gate.origin);
      expect(next.readyState).toBe(WebSocket.OPEN);
      next.terminate();
    } finally {
      await s.close();
    }
  });
});
