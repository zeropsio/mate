import { expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { serve, deadline } from "../../harness/http.ts";
import { observeTraffic, percentile } from "./traffic.ts";

// Catches budget instrumentation rewriting HQ data or counting only its first frame.
it("observes real payload bytes and first data without changing the upstream response", async () => {
  const upstream = await serve(
    () => ({ body: { real: "HQ" } }),
    (socket) => {
      socket.send("first");
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
    await observer.firstData(1);
    expect(await first).toBe("first");
    const echo = deadline(
      new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString()))),
      "echo",
    );
    socket.send("second");
    expect(await echo).toBe("second");
    expect(observer.segments[0]).toMatchObject({ frames: 2, downBytes: 11 });
    expect(observer.segments[0]!.firstDataMs).toBeGreaterThanOrEqual(0);
    expect(await (await fetch(observer.origin)).json()).toEqual({ real: "HQ" });
  } finally {
    socket.terminate();
    await observer.close();
    await upstream.close();
  }
});

// Catches a five-tab slow outlier disappearing from the reported p95.
it("uses nearest-rank percentiles so five-tab p95 includes the slowest tab", () => {
  expect(percentile([600, 10, 20, 300, 30], 0.5)).toBe(30);
  expect(percentile([600, 10, 20, 300, 30], 0.95)).toBe(600);
});
