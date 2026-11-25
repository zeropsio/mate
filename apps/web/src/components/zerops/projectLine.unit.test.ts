import { expect, it } from "vite-plus/test";
import { changeStateFor } from "@t3tools/client-runtime/zerops";

import { waitingWords } from "./system/projectLine.logic";

// witness: apps/web/src/components/zerops/system/projectLine.logic.ts | word === READY_TO_MERGE → true
it('MN78: A change that waits on the person reads "Ready for your review" on the project\'s line and under "Waiting on you" only where nothing stops it: one whose GitHub checks failed, or that anything else stops, keeps that word.', () => {
  const passing = {
    number: 1,
    title: "Add a feature",
    kind: "code",
    mergeability: "mergeable",
    pullRequest: { state: "open", checks: "passing" },
  } as const;
  const failing = { ...passing, pullRequest: { state: "open", checks: "failing" } } as const;
  const standing = { word: "Ready to merge" };
  const setup = { ...passing, kind: "recipe" } as const;

  expect(changeStateFor(setup, standing)?.word).toBe("Ready to merge");
  const rows = [
    [changeStateFor(passing, standing)?.word, false, "Ready for your review"],
    [changeStateFor(failing, standing)?.word, false, "GitHub's checks failed"],
    ["Conflicts with main", false, "Conflicts with main"],
    ["Draft", false, "Draft"],
    ["Sam R. commented", false, "Sam R. commented"],
    ["Ready", false, "Ready"],
    ["Changes the project's setup", true, "Ready for your review"],
  ] as const;
  for (const [word, isSetup, expected] of rows) {
    expect(waitingWords(word, isSetup)).toBe(expected);
  }
});
