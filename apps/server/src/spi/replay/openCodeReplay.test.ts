import { assert, describe, expect, it } from "vite-plus/test";

import { recordOpenCodeBaseline, recordOpenCodeTurn } from "./openCodeReplay.ts";

describe("recordOpenCodeBaseline", () => {
  it("records an OpenCode baseline (canned SSE deltas -> item.completed)", async () => {
    const events = await recordOpenCodeBaseline();
    const types = events.map((event) => event.type);

    assert.include(types, "session.started");
    assert.include(types, "content.delta");
    assert.include(types, "item.completed");

    const deltas = events.filter((event) => event.type === "content.delta") as ReadonlyArray<{
      readonly payload: { readonly delta: string };
    }>;
    assert.deepEqual(
      deltas.map((event) => event.payload.delta),
      ["Hello from", " OpenCode"],
    );

    const completed = events.find((event) => event.type === "item.completed") as
      | { readonly payload: { readonly detail?: string } }
      | undefined;
    assert.equal(completed?.payload.detail, "Hello from OpenCode");
  }, 15_000);
});

// A connected stream without the turn's terminal event cannot produce a complete recording.
it("rejects a recording whose provider never completes the turn", async () => {
  await expect(recordOpenCodeTurn([{ type: "server.heartbeat", properties: {} }])).rejects.toThrow(
    /timed out|Timeout/i,
  );
}, 15_000);
