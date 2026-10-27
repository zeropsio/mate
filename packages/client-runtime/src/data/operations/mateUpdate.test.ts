import { describe, expect, it } from "vite-plus/test";
import { updateOutcome } from "./mateUpdate.ts";

describe("Mate update evidence", () => {
  const pressed = { from: "1", bootId: "old" };
  it("a dropped socket or the same boot proves no outcome", () => {
    expect(updateOutcome(pressed, null)).toBeNull();
    expect(updateOutcome(pressed, { serverVersion: "1", bootId: "old" })).toBeNull();
    expect(updateOutcome(pressed, { serverVersion: "1" })).toBeNull();
  });
  it("a changed version proves an update, including a late return", () => {
    expect(updateOutcome(pressed, { serverVersion: "2", bootId: "new" })).toEqual({
      kind: "succeeded",
    });
  });
  it("a later boot on the original version proves the update did not take", () => {
    expect(updateOutcome(pressed, { serverVersion: "1", bootId: "new" })).toEqual({
      kind: "failed",
      reason: "The update did not take: this Mate is still on 1.",
    });
  });
  it("an absent original boot cannot prove a restart on the same version", () => {
    expect(updateOutcome({ from: "1" }, { serverVersion: "1", bootId: "new" })).toBeNull();
  });
});
