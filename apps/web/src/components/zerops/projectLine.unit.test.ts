import { expect, it } from "vite-plus/test";
import { changeStateFor } from "@t3tools/client-runtime/zerops";

import { waitingWords } from "./system/projectLine.logic";

// witness: apps/web/src/components/zerops/system/projectLine.logic.ts | word?.startsWith(READY_TO_MERGE) === true → false
it('MN78: A change that waits on the person reads "Ready for your review" on the project\'s line and under "Waiting on you" only when its Review build is passing, unavailable or absent and nothing else stops it; awaiting or failing keeps that word, and a result keeps its label.', () => {
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
    ["Awaiting Review build", false, "Awaiting Review build"],
    ["Review build failed", false, "Review build failed"],
    ["Ready to merge · Review build passed", false, "Ready for your review · Review build passed"],
    [
      "Ready to merge · Review build unavailable (no result arrived)",
      false,
      "Ready for your review · Review build unavailable (no result arrived)",
    ],
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
