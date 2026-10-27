import { expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { applicationDetailsGate } from "./hqDetails.ts";
import { deadline, serve } from "../../harness/http.ts";

// Catches a latency driver that invents HQ data, blocks summaries, or loses the held frame.
it("passes summaries unchanged and releases actual detail frames unchanged", async () => {
  const raw = "not JSON";
  const summary = JSON.stringify({
    type: "scope-reset",
    scope: { kind: "navigation" },
    values: [{ id: "shop", name: "Shop" }],
  });
  const detail = JSON.stringify({
    type: "scope-reset",
    scope: { kind: "app-detail", appId: "shop" },
    values: [{ key: "recipes", value: {} }],
  });
  const core = await serve(
    () => undefined,
    (socket) => {
      socket.send(raw, { binary: true });
      socket.send(summary);
      socket.send(detail);
    },
  );
  const gate = await applicationDetailsGate(core.origin);
  gate.hold("shop");
  const client = new WebSocket(gate.origin.replace("http", "ws"));
  const frames: string[] = [];
  let summarySignal = () => {};
  const receivedSummary = new Promise<void>((resolve) => {
    summarySignal = resolve;
  });
  let signal = () => {};
  const returned = new Promise<void>((resolve) => {
    signal = resolve;
  });
  client.on("message", (data) => {
    frames.push(String(data));
    if (frames.includes(summary)) summarySignal();
    if (frames.includes(detail)) signal();
  });
  try {
    await Promise.all([gate.waitForHeld(), deadline(receivedSummary, "summary delivered")]);
    expect(frames).toEqual([raw, summary]);
    gate.release();
    await deadline(returned, "detail frame released");
    expect(frames).toEqual([raw, summary, detail]);
  } finally {
    client.terminate();
    await gate.close();
    await core.close();
  }
});
