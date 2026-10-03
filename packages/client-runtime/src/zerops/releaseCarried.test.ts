import { describe, expect, it } from "vite-plus/test";

import {
  releaseCarriedToggleLabel,
  releaseDescription,
  rolledBackDescription,
  rolledBackTo,
} from "./releaseCarried.ts";
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

// e2e 2026-10-03: B's roll back to v0.1.0 made v0.1.2, whose row said only "app 30f75f9" — what it
// carried compares v0.1.1 to v0.1.2, which goes back, and lists nothing.
describe("the release a roll back went back to", () => {
  const release = (tag: string, commit: string, verdict: "approved" | "refused" = "approved") => ({
    tag,
    verdict,
    entries: [{ service: "app", commit: commit.repeat(40) }],
  });
  const releases = [
    release("v0.1.3", "c"),
    release("v0.1.2", "a"),
    release("v0.1.1", "b"),
    release("v0.1.0", "a"),
  ];

  it.each([
    ["a release listing an earlier one's commits is that one again", "v0.1.2", "v0.1.0"],
    ["a release of new commits went back to nothing", "v0.1.1", undefined],
    ["the first release went back to nothing", "v0.1.0", undefined],
    ["the newest, on new commits, went back to nothing", "v0.1.3", undefined],
  ] as const)("%s", (_case, tag, expected) => {
    expect(
      rolledBackTo(
        releases.find((entry) => entry.tag === tag)!,
        releases,
      ),
    ).toBe(expected);
  });

  it("names the release that first shipped the commits, and none HQ refused", () => {
    const again = [release("v0.1.4", "a"), ...releases];
    expect(rolledBackTo(again[0]!, again)).toBe("v0.1.0");
    const refused = [
      release("v0.1.2", "a"),
      release("v0.1.1", "b"),
      release("v0.1.0", "a", "refused"),
    ];
    expect(rolledBackTo(refused[0]!, refused)).toBeUndefined();
  });

  it("says so on its row, over its shas", () => {
    expect(rolledBackDescription("v0.1.0", "app 30f75f9")).toEqual({
      primary: "Rolled back to v0.1.0",
      secondary: "app 30f75f9",
    });
  });

  it("is no roll back where the release before it lists the same commits", () => {
    const same = [release("v0.1.1", "a"), release("v0.1.0", "a")];
    expect(rolledBackTo(same[0]!, same)).toBeUndefined();
  });
});
