import { describe, expect, it } from "vite-plus/test";

import {
  automatedWords,
  freeWords,
  inReview,
  productionUnder,
  projectState,
  releaseSegment,
  stageUnder,
} from "./projectRoad.logic";

const RUNS = { dot: "running", trouble: false } as const;
const NONE = { dot: "none", trouble: false } as const;
const MATE = { coming: undefined };
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
});

describe("a project's road", () => {
  it("counts the code changes in review, never a Mate's setup files", () => {
    const pull = (kind: "code" | "recipe") => ({ pull: { kind } }) as never;
    expect(inReview({ pullRequests: [pull("code"), pull("recipe"), pull("code")] })).toBe(2);
  });

  it.each([
    {
      name: "says what the stage follows and how long ago it was deployed",
      line: { dot: "running", words: ["Running"], trouble: false },
      want: { words: ["main", "25m"], tone: "muted" },
    },
    {
      name: "says a stage's failed deploy in red",
      line: { dot: "failed", words: ["Deploy failed"], trouble: true },
      want: { words: ["Deploy failed"], tone: "failed" },
    },
  ] as const)("a stage $name", ({ line, want }) => {
    expect(stageUnder(line, { source: "main", age: "25m" })).toEqual(want);
  });

  it.each([
    {
      name: "says what it runs and for how long",
      line: { dot: "running", words: ["Running", "v0.1.3"], trouble: false },
      version: "v0.1.3",
      want: ["v0.1.3", "up 6d"],
    },
    {
      name: "still says what it runs after a failed release",
      line: { dot: "failed", words: ["Release failed"], trouble: true },
      version: "v0.1.2",
      want: ["v0.1.2", "up 6d"],
    },
    {
      name: "says it is not live where nothing runs",
      line: { dot: "none", words: ["Not released yet"], trouble: false },
      version: undefined,
      want: ["not live"],
    },
  ] as const)("production $name", ({ line, version, want }) => {
    expect(productionUnder(line, { version, up: "6d" }).words).toEqual(want);
  });

  it.each([
    {
      name: "carries a failed release on the line it failed on, over a release ready",
      production: { dot: "failed", trouble: true },
      ready: { count: 2, atLeast: false },
      productionAbsent: false,
      notLive: 2,
      want: { kind: "failed", tag: "v0.1.3" },
    },
    {
      name: "carries a release ready to go",
      production: RUNS,
      ready: { count: 3, atLeast: false },
      productionAbsent: false,
      notLive: 3,
      want: { kind: "ready", count: 3, atLeast: false },
    },
    {
      name: "carries what is merged where there is no production to go to",
      production: NONE,
      ready: undefined,
      productionAbsent: true,
      notLive: 4,
      want: { kind: "merged", count: 4 },
    },
    {
      name: "carries nothing where nothing waits",
      production: RUNS,
      ready: undefined,
      productionAbsent: false,
      notLive: 0,
      want: { kind: "none" },
    },
  ] as const)("$name", ({ want, ...input }) => {
    expect(releaseSegment({ ...input, failedTag: "v0.1.3" })).toEqual(want);
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
  ])("folds automated Mates into one line: $want", ({ mates, want }) => {
    expect(automatedWords(mates)).toBe(want);
  });
});
