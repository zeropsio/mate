import { describe, expect, it } from "vite-plus/test";

import { HANDED_OVER_FOR_MS, handOverMateConversation, handedOverRecently } from "./mateHandOver";

describe("a Mate's own view handing over to its conversation", () => {
  it("counts as handed over for a moment, then not", () => {
    handOverMateConversation("env:a", 1_000);
    expect(handedOverRecently("env:a", 1_000)).toBe(true);
    expect(handedOverRecently("env:a", 1_000 + HANDED_OVER_FOR_MS)).toBe(false);
    expect(handedOverRecently("env:other", 1_000)).toBe(false);
  });
});
