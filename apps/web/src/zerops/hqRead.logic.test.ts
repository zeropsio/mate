import { describe, expect, it } from "vite-plus/test";
import { unreadFlowWords } from "./hqRead.logic";

describe("an unread HQ project's words", () => {
  it.each([
    ["still reading", false, false, undefined, null],
    [
      "HQ's current structure lacks it",
      true,
      false,
      undefined,
      "This project isn't here any more.",
    ],
    ["HQ does not answer", false, true, "HQ isn't answering.", "HQ isn't answering."],
    ["its flow has not landed", true, true, undefined, null],
  ] as const)("%s", (_case, groupsRead, groupKnown, failure, words) => {
    expect(unreadFlowWords({ groupsRead, groupKnown, failure })).toBe(words);
  });
});
