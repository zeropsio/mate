import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { cappedChangeGroups, projectChangeGroups } from "./projectChangesCard.logic";

function pull(number: number, over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number,
    title: `Change ${String(number)}`,
    kind: "code",
    mateProjectId: "p-raya",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: `app #${String(number)}`,
    updatedAt: "2026-10-18T10:00:00Z",
    ...over,
  };
}

const merged = (number: number, at: string, over: Partial<FlowPullRequest> = {}) =>
  pull(number, { merged: true, mergedAt: at, ...over });

const release = (tag: string, taggedAt: string, live = false) => ({ tag, taggedAt, live });

const NO_STAGE = undefined;

describe("projectChangeGroups", () => {
  it("lifts the open changes that ask for review, and keeps a draft apart", () => {
    const groups = projectChangeGroups({
      open: [pull(1), pull(2, { ready: false })],
      merged: [],
      releases: [],
      stage: NO_STAGE,
      production: false,
    });
    expect(groups.waiting.map((change) => change.pull.number)).toEqual([1]);
    expect(groups.drafts.map((change) => change.pull.number)).toEqual([2]);
  });

  it("holds merged work no release took as ready to release while a production stands", () => {
    const groups = projectChangeGroups({
      open: [],
      merged: [merged(3, "2026-10-18T09:00:00Z"), merged(2, "2026-10-10T09:00:00Z")],
      releases: [release("v0.1.0", "2026-10-12T09:00:00Z", true)],
      stage: NO_STAGE,
      production: true,
    });
    expect(groups.ready.title).toBe("Ready to release");
    expect(groups.ready.changes.map((change) => change.pull.number)).toEqual([3]);
    expect(groups.releases[0]?.changes.map((change) => change.pull.number)).toEqual([2]);
  });

  it("calls merged work merged where there is no production to release it to", () => {
    const groups = projectChangeGroups({
      open: [],
      merged: [merged(3, "2026-10-18T09:00:00Z")],
      releases: [],
      stage: NO_STAGE,
      production: false,
    });
    expect(groups.ready.title).toBe("Merged");
  });

  it("says ready work is on stage only when the stage runs every one of it", () => {
    const stage = { runs: ["s3"], deploying: [], mainHeads: new Map([["app", "s3"]]) };
    const both = projectChangeGroups({
      open: [],
      merged: [merged(3, "2026-10-18T09:00:00Z", { mergeCommitSha: "s3" })],
      releases: [],
      stage,
      production: true,
    });
    expect(both.ready.onStage).toBe(true);
    const neither = projectChangeGroups({
      open: [],
      merged: [merged(3, "2026-10-18T09:00:00Z", { mergeCommitSha: "s3" })],
      releases: [],
      stage: { runs: [], deploying: [], mainHeads: new Map() },
      production: true,
    });
    expect(neither.ready.onStage).toBe(false);
  });

  it("groups released work under the release that took it, open down to the live one and folded past it", () => {
    const groups = projectChangeGroups({
      open: [],
      merged: [
        merged(5, "2026-10-17T09:00:00Z"),
        merged(4, "2026-10-11T09:00:00Z"),
        merged(3, "2026-10-05T09:00:00Z"),
        merged(2, "2026-10-04T09:00:00Z"),
        merged(1, "2026-09-20T09:00:00Z"),
      ],
      releases: [
        release("v0.1.3", "2026-10-12T09:00:00Z", true),
        release("v0.1.2", "2026-10-06T09:00:00Z"),
        release("v0.1.1", "2026-09-28T09:00:00Z"),
      ],
      stage: NO_STAGE,
      production: true,
    });
    expect(
      groups.releases.map((group) => [group.tag, group.open, group.live, group.changes.length]),
    ).toEqual([
      ["v0.1.3", true, true, 1],
      ["v0.1.2", false, false, 2],
      ["v0.1.1", false, false, 1],
    ]);
  });

  it("counts a folded release's changes only where every one of them is held", () => {
    const groups = projectChangeGroups({
      open: [],
      merged: [
        merged(3, "2026-10-05T09:00:00Z"),
        merged(2, "2026-10-04T09:00:00Z"),
        merged(1, "2026-09-20T09:00:00Z"),
      ],
      releases: [
        release("v0.1.3", "2026-10-12T09:00:00Z", true),
        release("v0.1.2", "2026-10-06T09:00:00Z"),
        release("v0.1.1", "2026-09-28T09:00:00Z"),
      ],
      stage: NO_STAGE,
      production: true,
    });
    // The held changes reach back past v0.1.1, so v0.1.3's none and v0.1.2's two are whole;
    // nothing says how far back the oldest release's go.
    expect(groups.releases.map((group) => group.count)).toEqual([0, 2, undefined]);
  });

  it("keeps the newest release open where none is known to run", () => {
    const groups = projectChangeGroups({
      open: [],
      merged: [],
      releases: [
        release("v0.2.0", "2026-10-12T09:00:00Z"),
        release("v0.1.0", "2026-10-01T09:00:00Z"),
      ],
      stage: NO_STAGE,
      production: true,
    });
    expect(groups.releases.map((group) => group.open)).toEqual([true, false]);
  });
});

describe("a project page's Changes, capped", () => {
  const many = projectChangeGroups({
    open: [
      pull(1),
      pull(2, { ready: false }),
      pull(3, { ready: false }),
      pull(4, { ready: false }),
      pull(5, { ready: false }),
    ],
    merged: [
      ...Array.from({ length: 5 }, (_, at) => merged(10 + at, `2026-10-18T0${String(at)}:00:00Z`)),
      ...Array.from({ length: 6 }, (_, at) => merged(20 + at, `2026-10-15T0${String(at)}:00:00Z`)),
    ],
    releases: [
      release("v3", "2026-10-16T00:00:00Z", true),
      release("v2", "2026-10-10T00:00:00Z"),
      release("v1", "2026-10-05T00:00:00Z"),
      release("v0", "2026-10-01T00:00:00Z"),
    ],
    stage: NO_STAGE,
    production: true,
  });

  it("lists a few of each group, newest first, and counts what Show all holds", () => {
    const { groups, hidden } = cappedChangeGroups(many, 3);
    expect(groups.drafts.map((change) => change.pull.number)).toEqual([2, 3, 4]);
    expect(groups.ready.changes).toHaveLength(3);
    expect(groups.releases[0]?.changes).toHaveLength(3);
    expect(groups.releases.filter((group) => !group.open)).toHaveLength(2);
    // One draft, two ready, three released under v3 and one folded release.
    expect(hidden).toBe(1 + 2 + 3 + 1);
  });

  it("lists none waiting for review where the page asks for them above", () => {
    const { groups } = cappedChangeGroups(many, 3, { reviewsAbove: true });
    expect(groups.waiting).toEqual([]);
    expect(cappedChangeGroups(many, 3).groups.waiting).toHaveLength(1);
  });

  it("holds nothing back where every group fits", () => {
    expect(cappedChangeGroups(many, Number.POSITIVE_INFINITY).hidden).toBe(0);
  });
});
