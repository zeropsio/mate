import { describe, expect, it } from "vite-plus/test";

import {
  automatedWords,
  freeWords,
  inReview,
  productionWords,
  projectState,
  releaseWords,
  stageWords,
} from "./projectRoad.logic";
import { unlifted } from "./projectCard.logic";

const RUNS = { dot: "running", trouble: false } as const;
const NONE = { dot: "none", trouble: false } as const;
const MATE = {};
const COMING = { coming: {} };

describe("a project's state line", () => {
  it.each([
    {
      name: "says a failed release first, over everything waiting on you",
      production: { dot: "failed", trouble: true },
      waitsOnYou: true,
      mates: [MATE],
      want: "Release failed",
    },
    {
      name: "says production down where its services failed",
      production: { dot: "down", trouble: true },
      waitsOnYou: false,
      mates: [MATE],
      want: "Down",
    },
    {
      name: "says it needs you where a Mate or a change waits on you",
      production: RUNS,
      waitsOnYou: true,
      mates: [MATE],
      want: "Needs you",
    },
    {
      name: "says it is setting up while its first Mate is and nothing runs",
      production: NONE,
      waitsOnYou: false,
      mates: [COMING],
      want: "Setting up",
    },
    {
      name: "says it runs where production runs, though a new Mate is on its way",
      production: RUNS,
      waitsOnYou: false,
      mates: [COMING],
      want: "Running",
    },
    {
      name: "says a release on its way",
      production: { dot: "releasing", trouble: false },
      waitsOnYou: false,
      mates: [MATE],
      want: "Releasing",
    },
    {
      name: "says it is in development where nothing runs",
      production: NONE,
      waitsOnYou: false,
      mates: [MATE],
      want: "In development",
    },
  ] as const)("$name", ({ production, waitsOnYou, mates, want }) => {
    expect(projectState({ production, waitsOnYou, mates }).words).toBe(want);
  });

  it.each([
    {
      name: "a change in review",
      review: 1,
      ready: undefined,
      waitsOnYou: true,
      want: "1 change in review",
    },
    {
      name: "a release ready to go",
      review: 0,
      ready: { count: 2, atLeast: false },
      waitsOnYou: false,
      want: "2 ready to release",
    },
    {
      name: "a change in review before a release ready to go",
      review: 2,
      ready: { count: 3, atLeast: false },
      waitsOnYou: true,
      want: "2 changes in review",
    },
    {
      // Nothing waits on the viewer but the release: an open change is no reason of theirs.
      name: "a release ready to go, though a change is open",
      review: 1,
      ready: { count: 2, atLeast: false },
      waitsOnYou: false,
      want: "2 ready to release",
    },
    {
      name: "a Mate's question, before a change in review",
      review: 1,
      ready: undefined,
      waitsOnYou: true,
      asking: ["Juno"],
      want: "Juno asks",
    },
  ] as const)("says why it needs you: $name", (row) => {
    const state = projectState({
      production: RUNS,
      waitsOnYou: row.waitsOnYou,
      mates: [MATE],
      review: row.review,
      ready: row.ready,
      asking: "asking" in row ? row.asking : undefined,
    });
    expect([state.words, state.reason]).toEqual(["Needs you", row.want]);
  });
});

describe("a project's places", () => {
  it("counts the code changes in review, never a Mate's setup files", () => {
    const pull = (kind: "code" | "recipe") => ({ pull: { kind } }) as never;
    expect(inReview({ pullRequests: [pull("code"), pull("recipe"), pull("code")] })).toBe(2);
  });

  it.each([
    {
      name: "says what the stage follows and how long ago it was deployed",
      line: { dot: "running", words: ["Running"], trouble: false },
      want: { words: ["Deployed 25m ago", "follows main"], tone: "muted" },
    },
    {
      name: "says a stage's failed deploy in red",
      line: { dot: "failed", words: ["Deploy failed"], trouble: true },
      want: { words: ["Deploy failed", "follows main"], tone: "failed" },
    },
  ] as const)("a stage $name", ({ line, want }) => {
    expect(stageWords(line, { source: "main", age: "25m" })).toEqual(want);
  });

  it("each of several stages says its own state and what it follows", () => {
    const running = { dot: "running", words: ["Running"], trouble: false } as const;
    expect([
      stageWords(running, { source: "main", age: "19m" }).words,
      stageWords(running, { source: "checkout-redesign", age: "2h" }).words,
      stageWords(
        { dot: "failed", words: ["Deploy failed"], trouble: true },
        { source: "perf", age: undefined },
      ).words,
    ]).toEqual([
      ["Deployed 19m ago", "follows main"],
      ["Deployed 2h ago", "follows checkout-redesign"],
      ["Deploy failed", "follows perf"],
    ]);
  });

  it.each([
    {
      name: "says what it runs and for how long",
      line: { dot: "running", words: ["Running", "v0.1.3"], trouble: false },
      version: "v0.1.3",
      want: ["Running", "v0.1.3", "up 6d"],
    },
    {
      name: "still says what it runs after a failed release",
      line: { dot: "failed", words: ["Release failed"], trouble: true },
      version: "v0.1.2",
      want: ["Release failed", "still runs v0.1.2"],
    },
    {
      name: "says it is not live where nothing runs",
      line: { dot: "none", words: ["Not released yet"], trouble: false },
      version: undefined,
      want: ["Not released yet"],
    },
  ] as const)("production $name", ({ line, version, want }) => {
    expect(productionWords(line, { version, up: "6d" })).toEqual(want);
  });

  it("offers the release production waits for by its count", () => {
    expect([releaseWords(2, false), releaseWords(20, true)]).toEqual(["Release 2", "Release 20+"]);
  });
});

describe("a card's folded Mates", () => {
  it.each([
    { names: ["Kai"], want: "Kai is free" },
    { names: ["Kai", "Ida"], want: "Kai and Ida are free" },
    { names: ["Kai", "Ida", "Uma"], want: "Kai, Ida and Uma are free" },
  ])("folds free Mates into one line: $want", ({ names, want }) => {
    expect(freeWords(names)).toBe(want);
  });

  it.each([
    {
      mates: [
        { name: "Odo", working: true },
        { name: "Tess", working: false },
      ],
      want: "Odo works on a task",
    },
    {
      mates: [
        { name: "Odo", working: true },
        { name: "Tess", working: true },
      ],
      want: "Odo and Tess work on tasks",
    },
    {
      mates: [
        { name: "Odo", working: false },
        { name: "Tess", working: false },
      ],
      want: "2 automated Mates wait for a task",
    },
    {
      // HQ hands a Mate whose change waits for review no task: it waits on the person, not a task.
      mates: [
        { name: "Odo", working: false, reviewing: true },
        { name: "Tess", working: false, reviewing: true },
      ],
      want: "Odo and Tess wait for your review",
    },
    {
      mates: [
        { name: "Odo", working: false, reviewing: true },
        { name: "Tess", working: false },
      ],
      want: "Odo waits for your review",
    },
    {
      mates: [
        { name: "Odo", working: true },
        { name: "Tess", working: false, reviewing: true },
      ],
      want: "Odo works on a task",
    },
  ])("folds automated Mates into one line: $want", ({ mates, want }) => {
    expect(automatedWords(mates)).toBe(want);
  });
});

describe("a card that lifts one thing", () => {
  it.each([
    {
      name: "says a second waiting Mate waits on you, as an ordinary row",
      reading: { text: "Stripe or Adyen?", tone: "ink", lift: { kind: "question" } },
      want: { text: "Waits on you · Stripe or Adyen?", tone: "ink", lift: undefined },
    },
    {
      name: "leaves a Mate that waits on nobody as it is",
      reading: { text: "Done.", tone: "muted", lift: undefined },
      want: { text: "Done.", tone: "muted", lift: undefined },
    },
  ] as const)("$name", ({ reading, want }) => {
    expect(unlifted(reading)).toEqual(want);
  });
});
