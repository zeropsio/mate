import { expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { serve, deadline } from "../harness/http.ts";
import { hqConnection } from "./hqConnection.ts";

it("HTTP readiness does not claim a socket frame; transport counts bytes in both directions", async () => {
  const upstream = await serve(
    (request) =>
      request.method === "POST"
        ? { bytes: request.rawBody ?? Buffer.alloc(0) }
        : { body: { hello: "http" } },
    (socket) => {
      socket.send("snapshot");
      socket.on("message", (frame, isBinary) => socket.send(frame, { binary: isBinary }));
    },
  );
  const proxy = await hqConnection(upstream.origin);
  await fetch(`${proxy.origin}/initial/http`);
  await proxy.ready();
  expect(proxy.counters.wsDownFrames).toBe(0);
  const socketReceipt = proxy.socketReady().then(() => proxy.counters.wsDownFrames);
  const socket = new WebSocket(`${proxy.origin.replace("http:", "ws:")}/future/protocol`);
  try {
    const frame = deadline(
      new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString()))),
      "first proxy frame",
    );
    expect(await socketReceipt).toBeGreaterThan(0);
    expect(await frame).toBe("snapshot");
    const echo = deadline(
      new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString()))),
      "echo",
    );
    socket.send("input");
    expect(await echo).toBe("input");
    expect(proxy.counters).toMatchObject({
      wsOpens: 1,
      wsDownFrames: 2,
      wsDownBytes: 13,
      wsUpFrames: 1,
      wsUpBytes: 5,
    });
    const binary = deadline(
      new Promise<{ data: Buffer; isBinary: boolean }>((resolve) =>
        socket.once("message", (data, isBinary) =>
          resolve({ data: Buffer.from(data as Buffer), isBinary }),
        ),
      ),
      "binary echo",
    );
    socket.send(Buffer.from([0, 127, 255]), { binary: true });
    expect(await binary).toEqual({ data: Buffer.from([0, 127, 255]), isBinary: true });
    expect(proxy.counters).toMatchObject({
      wsUpBytes: 8,
      wsDownBytes: 16,
      wsUpFrames: 2,
      wsDownFrames: 3,
    });
    expect((await fetch(`${proxy.origin}/future/http`)).status).toBe(200);
    expect(proxy.counters.httpDownBytes).toBeGreaterThan(0);
    const raw = await fetch(`${proxy.origin}/future/raw`, {
      method: "POST",
      headers: { "content-type": "application/x-future-protocol" },
      body: new Uint8Array([0, 127, 255]).buffer,
    });
    expect(raw.status).toBe(200);
    expect([...new Uint8Array(await raw.arrayBuffer())]).toEqual([0, 127, 255]);
    expect(proxy.counters.httpUpBytes).toBe(3);
    proxy.drops();
    const beforeOutage = proxy.counters.httpDownBytes;
    const refused = await fetch(`${proxy.origin}/future/http`);
    expect(refused.status).toBe(503);
    expect(proxy.counters.httpDownBytes - beforeOutage).toBe(
      (await refused.arrayBuffer()).byteLength,
    );
    proxy.returns();
    expect((await fetch(`${proxy.origin}/future/http`)).status).toBe(200);
  } finally {
    socket.terminate();
    await proxy.close();
    await upstream.close();
  }
});
