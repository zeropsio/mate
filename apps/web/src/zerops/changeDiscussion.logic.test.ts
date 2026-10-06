import { describe, expect, it } from "vite-plus/test";

import { commentRefusal } from "./changeDiscussion.logic";

describe("commentRefusal", () => {
  it.each([
    { stage: { stage: "accepted", operationId: "c1" }, said: null },
    { stage: { stage: "reflected", operationId: "c1" }, said: null },
    { stage: { stage: "done", operationId: "c1", outcome: "succeeded" }, said: null },
    { stage: { stage: "refused", reason: "You may not comment." }, said: "You may not comment." },
    {
      stage: { stage: "unsent", next: "send-again", reason: "HQ is not answering right now." },
      said: "HQ is not answering right now.",
    },
    {
      stage: { stage: "unsent", next: "send-again" },
      said: "HQ did not take the comment. Try again.",
    },
    {
      stage: { stage: "uncertain", next: "ask-owner-again" },
      said: "HQ did not answer whether it took the comment. It shows here once HQ has it.",
    },
  ] as const)("$stage.stage says $said", ({ stage, said }) => {
    expect(commentRefusal(stage)).toBe(said);
  });
});
