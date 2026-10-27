import { describe, expect, it } from "vite-plus/test";

import { CONTENT_CONTRACT } from "./contentContract.ts";

describe("CONTENT_CONTRACT", () => {
  it.each([
    ["the answer first", /first sentence is the answer or the outcome/],
    ["one IMPORTANT callout at the end for what the person must do", /one `> \[!IMPORTANT\]`/],
    ["nothing to do when the app already offers it", /merging a pull request/],
    ["corrections flagged as warnings", /`> \[!WARNING\]`: what was wrong and what is right/],
    ["risks flagged as cautions", /exposed secret.*`> \[!CAUTION\]`/],
    ["what changed, never a restated recap", /Say what changed\. Never restate/],
    ["the person's names for things", /the stage preview, production/],
    ["no internal names unless asked", /environment variables, hashes or query strings unless/],
    ["structure only for length", /more than three sections.*two levels deep.*comparisons/],
    ["messages sent mid-work join the task list", /task list.*one progress line.*quoting it/],
  ])("tells the agent %s", (_, rule) => {
    expect(CONTENT_CONTRACT).toMatch(rule);
  });

  it("is one tagged block of seven numbered rules", () => {
    expect(CONTENT_CONTRACT.startsWith("<writing>")).toBe(true);
    expect(CONTENT_CONTRACT.endsWith("</writing>")).toBe(true);
    expect(CONTENT_CONTRACT.match(/^\d\. /gm)).toHaveLength(7);
  });

  // Codex caps an additionalContext entry at ~1,000 tokens (4 bytes each) and
  // truncates the middle of a longer one; the runtime info shares the entry.
  it("stays well inside Codex's per-entry cap", () => {
    expect(Buffer.byteLength(CONTENT_CONTRACT)).toBeLessThan(2_000);
  });
});
