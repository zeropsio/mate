import { WebSocket } from "ws";
import { describe, expect, it } from "vite-plus/test";
import { serve } from "../../harness/http.ts";
import { changeTransport, MergeGate, HqFrameHold } from "./transport.ts";

describe("D: controlled transport to real HQ", () => {
  // Catches a proxy leaking Merge before release or rewriting Core's refusal.
  it("holds merge until released and preserves the upstream response", async () => {
    const seen: string[] = [];
    const upstream = await serve((request) => {
      seen.push(request.url.pathname);
      return { status: 409, body: { code: "conflict", reason: "change_not_open" } };
    });
    const gate = new MergeGate();
    const proxy = await changeTransport(upstream.origin, gate);
    try {
      gate.hold();
      const result = fetch(`${proxy.origin}/api/apps/shop/changes/appdev/1/merge`, {
        method: "POST",
      });
      await gate.received();
      expect(seen).toEqual([]);
      const detail = await fetch(`${proxy.origin}/api/apps/shop/changes/appdev/1`);
      expect(detail.status).toBe(409);
      gate.resume();
      const response = await result;
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ code: "conflict", reason: "change_not_open" });
      expect(seen).toEqual([
        "/api/apps/shop/changes/appdev/1",
        "/api/apps/shop/changes/appdev/1/merge",
      ]);
    } finally {
      gate.resume();
      await proxy.close();
      await upstream.close();
    }
  });
  // Catches the area proxy turning HQ's normal segment close into an unexpected outage.
  it("relays HQ frames and preserves the close code and reason", async () => {
    const upstream = await serve(
      () => undefined,
      (socket) => {
        socket.on("message", (frame) => {
          socket.send(String(frame));
          socket.close(1000, "segment");
        });
      },
    );
    const proxy = await changeTransport(upstream.origin, new MergeGate());
    const client = new WebSocket(proxy.origin.replace(/^http/u, "ws") + "/api/structure/ws");
    const message = new Promise<string>((resolve) =>
      client.once("message", (frame) => resolve(String(frame))),
    );
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      client.once("close", (code, reason) => resolve({ code, reason: String(reason) })),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      client.send("review-ready");
      expect(await message).toBe("review-ready");
      expect(await closed).toEqual({ code: 1000, reason: "segment" });
    } finally {
      client.terminate();
      await proxy.close();
      await upstream.close();
    }
  });
  // Catches a snapshot hold leaking a frame, losing it on release, or continuing to hold later frames.
  it("buffers HQ frames until release and then forwards new frames", async () => {
    const upstream = await serve(
      () => undefined,
      (socket) => {
        socket.on("message", (frame) => socket.send(String(frame)));
      },
    );
    const frames = new HqFrameHold();
    const proxy = await changeTransport(upstream.origin, new MergeGate(), frames);
    const client = new WebSocket(proxy.origin.replace(/^http/u, "ws") + "/api/structure/ws");
    const seen: string[] = [];
    client.on("message", (frame) => seen.push(String(frame)));
    try {
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      frames.hold();
      const first = new Promise<string>((resolve) =>
        client.once("message", (frame) => resolve(String(frame))),
      );
      client.send("snapshot");
      await frames.received();
      expect(seen).toEqual([]);
      frames.resume();
      expect(await first).toBe("snapshot");
      const next = new Promise<string>((resolve) =>
        client.once("message", (frame) => resolve(String(frame))),
      );
      client.send("next-frame");
      expect(await next).toBe("next-frame");
      expect(seen).toEqual(["snapshot", "next-frame"]);
      frames.hold((frame) => frame === "compare");
      client.send("compare");
      await frames.received();
      const fact = new Promise<string>((resolve) =>
        client.once("message", (frame) => resolve(String(frame))),
      );
      client.send("project-fact");
      expect(await fact).toBe("project-fact");
      expect(seen).toEqual(["snapshot", "next-frame", "project-fact"]);
      const comparison = new Promise<string>((resolve) =>
        client.once("message", (frame) => resolve(String(frame))),
      );
      frames.resume();
      expect(await comparison).toBe("compare");
    } finally {
      client.terminate();
      await proxy.close();
      await upstream.close();
    }
  });
});
