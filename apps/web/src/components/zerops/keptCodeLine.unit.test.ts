import { expect, it } from "vite-plus/test";
import { keptCodeLine } from "./KeptGitQuestions.logic.ts";

// witness: apps/web/src/components/zerops/KeptGitQuestions.logic.ts | count === 0 → count < 0
it("MN80: The menu says how many kept-code questions are open in one line and none when there is none; breaks: the menu offers the answer in a second place, or says nothing while a question waits", () => {
  expect(keptCodeLine(0)).toBeUndefined();
  expect(keptCodeLine(1)).toBe("1 question about kept code");
  expect(keptCodeLine(3)).toBe("3 questions about kept code");
});
