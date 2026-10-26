import { describe, expect, it } from "vite-plus/test";

import {
  carriedByRecords,
  carriedMoved,
  rollbackFromHistories,
  type CarriedChange,
} from "./releaseRecorded.ts";

const merged = (
  repo: string,
  number: number,
  extra: { sha?: string; at?: string; mate?: string },
) => ({
  repo,
  number,
  mateProjectId: extra.mate ?? "mate-1",
  mergedSha: extra.sha ?? null,
  mergedAt: extra.at ?? null,
});

describe("carriedMoved", () => {
  const repositories = new Map([
    ["api", "shop"],
    ["web", "shop"],
    ["docs", "site"],
  ]);
  const changes: ReadonlyArray<CarriedChange> = [
    { repo: "shop", number: 1, title: "Add cart" },
    { repo: "shop", number: 2, title: "Fix totals" },
    { repo: "site", number: 7, title: "Reword intro" },
  ];

  it("lists a repository's changes newest merge first, on the production runtimes built from it", () => {
    const moved = carriedMoved({
      changes,
      known: [
        merged("shop", 1, { sha: "a".repeat(40), at: "2026-10-01T10:00:00Z", mate: "mate-a" }),
        merged("shop", 2, { sha: "b".repeat(40), at: "2026-10-02T10:00:00Z", mate: "mate-b" }),
        merged("site", 7, { sha: "c".repeat(40), at: "2026-10-03T10:00:00Z" }),
      ],
      repositories,
    });
    expect(moved.map(({ repository, services, total }) => [repository, services, total])).toEqual([
      ["shop", ["api", "web"], 2],
      ["site", ["docs"], 1],
    ]);
    expect(
      moved[0]?.commits.map((commit) => [commit.sha[0], commit.change?.mateProjectId]),
    ).toEqual([
      ["b", "mate-b"],
      ["a", "mate-a"],
    ]);
  });

  it("keeps a change the change list lacks, with no Mate and no merge time", () => {
    const [shop] = carriedMoved({ changes: [changes[0]!], known: [], repositories });
    expect(shop?.commits).toEqual([
      expect.objectContaining({
        sha: "shop#1",
        at: "",
        change: expect.objectContaining({ mateProjectId: "" }),
      }),
    ]);
  });

  it("lists a change recorded twice once", () => {
    const [shop] = carriedMoved({ changes: [changes[0]!, changes[0]!], known: [], repositories });
    expect(shop?.total).toBe(1);
  });
});

describe("carriedByRecords", () => {
  it("reads while HQ has not recorded the changes, and is known once it has, empty or not", () => {
    const base = { known: [], repositories: undefined } as const;
    expect(carriedByRecords({ carried: { state: "pending" }, ...base })).toEqual({
      state: "reading",
    });
    expect(carriedByRecords({ carried: { state: "known", changes: [] }, ...base })).toEqual({
      state: "known",
      moved: [],
    });
  });
});

describe("rollbackFromHistories", () => {
  const release = (
    tag: string,
    history: { changes: ReadonlyArray<CarriedChange> } | undefined,
    extra: { rollbackOf?: string; state?: "approved" | "refused" } = {},
  ) => ({
    tag,
    state: extra.state ?? ("approved" as const),
    rollbackOf: extra.rollbackOf ?? null,
    ...(history === undefined
      ? {}
      : { history: { ranges: [], commitCount: 0, outsideCommitCount: 0, ...history } }),
  });
  const one = (number: number): CarriedChange => ({
    repo: "shop",
    number,
    title: `Change ${String(number)}`,
  });

  it.each([
    {
      name: "to an older release, what the releases above it carried leaves and nothing comes back",
      releases: [
        release("v0.3.0", { changes: [one(3)] }),
        release("v0.2.0", { changes: [one(2)] }),
        release("v0.1.0", { changes: [one(1)] }),
      ],
      live: "v0.3.0",
      target: "v0.1.0",
      leaving: { state: "known", changes: [one(3), one(2)] },
      comingBack: { state: "known", changes: [] },
    },
    {
      name: "to a newer release, what the releases up to it carried comes back and nothing leaves",
      releases: [
        release("v0.3.0", { changes: [one(3)] }),
        release("v0.2.0", { changes: [one(2)] }),
        release("v0.1.0", { changes: [one(1)] }),
      ],
      live: "v0.1.0",
      target: "v0.3.0",
      leaving: { state: "known", changes: [] },
      comingBack: { state: "known", changes: [one(3), one(2)] },
    },
    {
      name: "a refused release in between never ran, so it carries nothing",
      releases: [
        release("v0.3.0", { changes: [one(3)] }),
        release("v0.2.0", { changes: [one(2)] }, { state: "refused" }),
        release("v0.1.0", { changes: [] }),
      ],
      live: "v0.3.0",
      target: "v0.1.0",
      leaving: { state: "known", changes: [one(3)] },
      comingBack: { state: "known", changes: [] },
    },
    {
      name: "a release made before histories were recorded leaves its side unrecorded",
      releases: [release("v0.3.0", undefined), release("v0.2.0", { changes: [one(2)] })],
      live: "v0.3.0",
      target: "v0.2.0",
      leaving: { state: "unrecorded" },
      comingBack: { state: "known", changes: [] },
    },
    {
      name: "a roll back in between leaves both sides unrecorded",
      releases: [
        release("v0.3.0", { changes: [] }, { rollbackOf: "v0.1.0" }),
        release("v0.2.0", { changes: [one(2)] }),
        release("v0.1.0", { changes: [one(1)] }),
      ],
      live: "v0.3.0",
      target: "v0.2.0",
      leaving: { state: "unrecorded" },
      comingBack: { state: "unrecorded" },
    },
    {
      name: "a live release the list does not hold leaves both sides unrecorded",
      releases: [release("v0.2.0", { changes: [one(2)] })],
      live: undefined,
      target: "v0.2.0",
      leaving: { state: "unrecorded" },
      comingBack: { state: "unrecorded" },
    },
  ])("$name", ({ releases, live, target, leaving, comingBack }) => {
    expect(rollbackFromHistories({ releases, live, target })).toEqual({ leaving, comingBack });
  });
});
