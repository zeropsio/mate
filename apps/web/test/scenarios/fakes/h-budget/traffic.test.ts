import { expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { serve, deadline } from "../../harness/http.ts";
import { observeTraffic, percentile } from "./traffic.ts";

// Catches heartbeats or role answers satisfying first-data and unchanged-state budgets.
it("ignores control traffic and measures first Shop data without rewriting frames", async () => {
  const ping = JSON.stringify({ type: "ping" });
  const roles = JSON.stringify({ type: "roles", rolesAnsweredAt: "now" });
  const snapshot = JSON.stringify({ apps: [{ name: "Shop" }] });
  // A scope's catchup end names its scope (a Mate's project), never a fact.
  const ready = JSON.stringify({
    type: "scope-ready",
    scope: { kind: "attention", projectId: "Ada" },
    incarnation: "i",
    revision: 1,
  });
  const upstream = await serve(
    () => ({ body: { real: "HQ" } }),
    (socket) => {
      socket.send(ping);
      socket.on("message", (data, binary) => socket.send(data, { binary }));
    },
  );
  const observer = await observeTraffic(upstream.origin);
  const socket = new WebSocket(observer.origin.replace("http:", "ws:"));
  try {
    const first = deadline(
      new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString()))),
      "first data",
    );
    await observer.opened(1);
    expect(await first).toBe(ping);
    expect(observer.segments[0]).toMatchObject({ firstDataMs: null, stateBytes: 0 });
    const echo = deadline(
      new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString()))),
      "echo",
    );
    socket.send(roles);
    expect(await echo).toBe(roles);
    expect(observer.segments[0]).toMatchObject({ firstDataMs: null, stateBytes: 0 });
    const readyEcho = deadline(
      new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString()))),
      "ready echo",
    );
    socket.send(ready);
    expect(await readyEcho).toBe(ready);
    expect(observer.segments[0]).toMatchObject({ firstDataMs: null, stateBytes: 0 });
    const data = deadline(
      new Promise<string>((resolve) =>
        socket.once("message", (frame) => resolve(frame.toString())),
      ),
      "Shop state",
    );
    socket.send(snapshot);
    await observer.firstData(1);
    expect(await data).toBe(snapshot);
    expect(observer.segments[0]).toMatchObject({
      frames: 4,
      downBytes: ping.length + roles.length + ready.length + snapshot.length,
      stateBytes: snapshot.length,
    });
    expect(observer.segments[0]!.firstDataMs).toBeGreaterThanOrEqual(0);
    expect(await (await fetch(observer.origin)).json()).toEqual({ real: "HQ" });
  } finally {
    socket.terminate();
    await observer.close();
    await upstream.close();
  }
});

// Catches an unchanged segment budget requiring a heartbeat or snapshot before it can pass.
it("a replacement socket can open and settle with zero frames and zero state bytes", async () => {
  const upstream = await serve(
    () => ({ body: {} }),
    () => {},
  );
  const observer = await observeTraffic(upstream.origin);
  const first = new WebSocket(observer.origin.replace("http:", "ws:"));
  let next: WebSocket | undefined;
  try {
    await observer.opened(1);
    const closed = deadline(
      new Promise<void>((resolve) => first.once("close", () => resolve())),
      "segment ending",
    );
    observer.endSegment();
    await closed;
    next = new WebSocket(observer.origin.replace("http:", "ws:"));
    await observer.opened(2);
    await observer.stateSettled();
    expect(observer.segments[1]).toMatchObject({
      open: true,
      frames: 0,
      stateBytes: 0,
      firstDataMs: null,
    });
  } finally {
    first.terminate();
    next?.terminate();
    await observer.close();
    await upstream.close();
  }
});

// Catches a five-tab slow outlier disappearing from the reported p95.
it("uses nearest-rank percentiles so five-tab p95 includes the slowest tab", () => {
  expect(percentile([600, 10, 20, 300, 30], 0.5)).toBe(30);
  expect(percentile([600, 10, 20, 300, 30], 0.95)).toBe(600);
});
