import { describe, expect, it } from "vite-plus/test";

import { signInTokensWords } from "./zeropsSettings.logic";

// The person's own sign-in tokens — the Zerops tokens Mate makes to open HQ — are cleaned up from
// Settings → Zerops, where the button says how the cleanup goes, never as a lone button over the
// overview's cards (the owner, 2026-10-11).
describe("signInTokensWords", () => {
  it.each([
    { state: "idle", words: "Clean up" },
    { state: "running", words: "Cleaning up…" },
    { state: "done", words: "Cleaned up" },
    { state: "failed", words: "Failed. Try again" },
  ] as const)("the sign-in tokens' cleanup says $words while $state", ({ state, words }) => {
    expect(signInTokensWords(state)).toBe(words);
  });
});
