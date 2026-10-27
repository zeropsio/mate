import { assert, describe, it } from "vite-plus/test";

import { recordCursorBaseline, recordGrokBaseline } from "./acpReplay.ts";

describe("acpReplay", () => {
  it("records a Cursor ACP baseline (session start -> mock prompt -> turn.completed)", async () => {
    const events = await recordCursorBaseline();
    const types = events.map((event) => event.type);

    for (const expected of [
      "session.started",
      "thread.started",
      "turn.started",
      "item.started",
      "content.delta",
      "item.completed",
      "turn.completed",
    ]) {
      assert.include(types, expected);
    }

    const delta = events.find((event) => event.type === "content.delta") as
      | { readonly payload: { readonly delta: string } }
      | undefined;
    assert.equal(delta?.payload.delta, "hello from mock");
  }, 30_000);

  it("records a Grok ACP baseline (session start -> mock prompt -> turn.completed)", async () => {
    const events = await recordGrokBaseline();
    const types = events.map((event) => event.type);

    for (const expected of [
      "session.started",
      "thread.started",
      "turn.started",
      "item.started",
      "content.delta",
      "turn.completed",
    ]) {
      assert.include(types, expected);
    }

    const delta = events.find((event) => event.type === "content.delta") as
      | { readonly payload: { readonly delta: string } }
      | undefined;
    assert.equal(delta?.payload.delta, "hello from mock");
  }, 30_000);
});
