import { describe, expect, it } from "vite-plus/test";

import { capped, developmentStep, inDevelopment, needsInOrder } from "./projectPage.logic";

describe("a project page's needs", () => {
  it("asks what went wrong first, then a Mate's question, then a release, then reviews", () => {
    const needs = needsInOrder([
      { kind: "review", key: "r1" },
      { kind: "release", key: "v" },
      { kind: "review", key: "r2" },
      { kind: "ask", key: "esme" },
      { kind: "trouble", key: "stage" },
      { kind: "trouble", key: "production" },
    ] as const);
    expect(needs.map((need) => need.key)).toEqual(["stage", "production", "esme", "v", "r1", "r2"]);
  });

  it.each([
    { rows: 0, max: 3, shown: 0, hidden: 0 },
    { rows: 3, max: 3, shown: 3, hidden: 0 },
    { rows: 20, max: 3, shown: 3, hidden: 17 },
  ])(
    "lists $shown of $rows before Show all, which holds $hidden",
    ({ rows, max, shown, hidden }) => {
      const cut = capped(
        Array.from({ length: rows }, (_, at) => at),
        max,
      );
      expect(cut.shown).toHaveLength(shown);
      expect(cut.hidden).toBe(hidden);
    },
  );
});

describe("a project in development", () => {
  it.each([
    { case: "nothing set up", input: {}, developing: true },
    { case: "a production", input: { productionAbsent: false }, developing: false },
    { case: "a stage", input: { stages: 1 }, developing: false },
    { case: "a stage being added", input: { stageBeingAdded: true }, developing: false },
    { case: "a place the platform holds", input: { placesHeld: true }, developing: false },
  ])("is one with no production and no stage: $case", ({ input, developing }) => {
    expect(
      inDevelopment({
        productionAbsent: true,
        stages: 0,
        stageBeingAdded: false,
        placesHeld: false,
        ...input,
      }),
    ).toBe(developing);
  });

  it.each([
    {
      case: "merged work to put live",
      input: { canPutLive: true, reviews: 2, mates: [{ name: "Pia", working: true }] },
      kind: "put-live",
    },
    {
      case: "changes waiting for review",
      input: { canPutLive: false, reviews: 2, mates: [{ name: "Pia", working: true }] },
      kind: "review",
    },
    {
      case: "a Mate at work",
      input: {
        canPutLive: false,
        reviews: 0,
        mates: [
          { name: "Pia", working: false },
          { name: "Oren", working: true },
        ],
      },
      kind: "open-mate",
      mate: "Oren",
    },
    {
      case: "a Mate just made",
      input: { canPutLive: false, reviews: 0, mates: [{ name: "Pia", working: false }] },
      kind: "open-mate",
      mate: "Pia",
    },
    { case: "no Mate", input: { canPutLive: false, reviews: 0, mates: [] }, kind: "add-mate" },
  ])("names one next step with its why: $case", ({ input, kind, mate }) => {
    const step = developmentStep(input);
    expect(step.kind).toBe(kind);
    if (mate !== undefined) expect(step).toMatchObject({ mate });
    expect(step.title).not.toBe("");
    expect(step.words.split(". ").length).toBeLessThanOrEqual(2);
  });
});
