import { describe, expect, it } from "vite-plus/test";

import { releaseCarriedToggleLabel, releaseDescription } from "./releaseCarried.ts";
import type { Moved } from "./releaseCompare.ts";

const sha = (char: string) => char.repeat(40);

describe("the line a release says it carried", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const LINE = "titan 1bcc930";
  const names = { mateNames: new Map([["PXGYIVK9RLWlE3eTL3QwoW", "Theo"]]) };
  /** One repository's comparison: its commits listed, newest first, and how many HQ counted. */
  const moved = (
    service: string,
    subjects: ReadonlyArray<string>,
    over: { readonly mateProjectId?: string; readonly total?: number } = {},
  ): Moved => ({
    repository: service,
    services: [service],
    commits: subjects.map((subject, index) => ({
      sha: sha(String(index)),
      subject,
      authorName: "ales",
      at: "2026-09-19T08:00:00Z",
      change:
        index === 0 && over.mateProjectId !== undefined
          ? { number: 4, title: subject, mateProjectId: over.mateProjectId }
          : null,
    })),
    total: over.total ?? subjects.length,
    truncated: (over.total ?? subjects.length) > subjects.length,
  });

  it.each([
    [
      "one commit says its subject and nothing more",
      [moved("titan", ["v0.23.0: the void (#32)"])],
      undefined,
      { primary: "v0.23.0: the void (#32)", secondary: `ales · 4h · ${LINE}` },
    ],
    [
      "several commits say how many more",
      [moved("nextstore", ["Fix the cart", "b", "c", "d"])],
      undefined,
      { primary: "Fix the cart, +3 more", secondary: `ales · 4h · ${LINE}` },
    ],
    [
      "commits HQ counted beyond what it listed are more too",
      [moved("nextstore", ["Fix the cart"], { total: 120 })],
      undefined,
      { primary: "Fix the cart, +119 more", secondary: `ales · 4h · ${LINE}` },
    ],
    [
      "two repositories moved name the one it leads with",
      [moved("api", ["Fix the cart", "b"]), moved("web", ["Restyle", "c"])],
      undefined,
      { primary: "api: Fix the cart, +3 more", secondary: `ales · 4h · ${LINE}` },
    ],
    [
      "a Mate's change is the Mate's, whoever wrote its commit",
      [moved("titan", ["Deploy the link keeper"], { mateProjectId: "PXGYIVK9RLWlE3eTL3QwoW" })],
      names,
      { primary: "Deploy the link keeper", secondary: `Theo · 4h · ${LINE}` },
    ],
    ["nothing carried says nothing", [], undefined, undefined],
  ] as const)("%s", (_case, carried, withNames, expected) => {
    expect(releaseDescription(carried, LINE, now, withNames)).toEqual(expected);
  });
});

describe("what a release row's chevron does, for a screen reader", () => {
  it.each([
    [false, "Show what v0.1.27 carried"],
    [true, "Hide what v0.1.27 carried"],
  ] as const)("open %s reads %s", (open, expected) => {
    expect(releaseCarriedToggleLabel("v0.1.27", open)).toBe(expected);
  });
});
