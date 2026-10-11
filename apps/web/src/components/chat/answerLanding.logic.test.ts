import { describe, expect, it } from "vite-plus/test";

import { landingHolds } from "./answerLanding.logic";

describe("an answer landing from its run's slot", () => {
  it.each([
    {
      name: "holds the card's head still when the answer stood whole in the slot",
      input: { head: true, whole: true },
      holds: "head",
    },
    {
      name: "keeps the lines the person was reading when the slot's cap cut the answer",
      input: { head: true, whole: false },
      holds: "words",
    },
    {
      name: "keeps the lines the person was reading when its card's head is not on the page",
      input: { head: false, whole: true },
      holds: "words",
    },
  ] as const)("$name", ({ input, holds }) => {
    expect(landingHolds(input)).toBe(holds);
  });
});
