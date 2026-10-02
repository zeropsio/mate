import { describe, expect, it } from "vite-plus/test";

import type { GiteaRepository } from "../giteaClient.ts";
import { createForgeReads, GATE_FRESH_MS } from "./forgeReads.ts";
import {
  createPullWatch,
  FORGE_REFRESH_MS,
  PULL_WATCH_MS,
  pullCadenceMs,
  pullWatchGroups,
  type PullWatchGroup,
} from "./pullWatch.ts";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const LONG_AGO = "2026-10-01T08:00:00Z";

const repo = (name: string, openPulls: number, updatedAt = LONG_AGO): GiteaRepository => ({
  id: name.length,
  name,
  full_name: `quill/${name}`,
  default_branch: "main",
  updated_at: updatedAt,
  open_pr_counter: openPulls,
});

/** One org on a fake clock: every listing counted, every repository the watch says moved kept. */
function rig(listed: Array<GiteaRepository>) {
  const state = { listed };
  let clock = NOW;
  const listings: number[] = [];
  const moved: string[] = [];
  const reads = createForgeReads({ now: () => clock });
  const load = async () => {
    listings.push(clock);
    return state.listed;
  };
  const watch = createPullWatch({
    reads,
    list: () => load(),
    moved: (groupId, repository) => moved.push(`${groupId} ${repository}`),
  });
  return {
    state,
    listings,
    moved,
    watch,
    /** The forge pass's own minute tick: the shared listing at its usual freshness. */
    pass: () => reads.repositories("quill", load),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const group = (openPulls: number): PullWatchGroup => ({
  groupId: "g-quill",
  slug: "quill",
  openPulls,
});

describe("pullCadenceMs", () => {
  it.each([
    { case: "no pull request open", open: 0, expected: FORGE_REFRESH_MS },
    { case: "one open", open: 1, expected: PULL_WATCH_MS },
    { case: "several open", open: 4, expected: PULL_WATCH_MS },
  ])("$case: every $expected ms", ({ open, expected }) => {
    expect(pullCadenceMs(open)).toBe(expected);
  });

  it("watches faster than the minute's refresh, and no faster than the gate can tell", () => {
    expect(PULL_WATCH_MS).toBeLessThan(FORGE_REFRESH_MS);
    expect(PULL_WATCH_MS).toBeLessThan(GATE_FRESH_MS);
  });
});

describe("pullWatchGroups", () => {
  it("counts each group's open pull requests from its answer, none while unanswered", () => {
    const groups = [
      { groupId: "g-quill", slug: "quill" },
      { groupId: "g-larch", slug: "larch" },
      { groupId: "g-fern", slug: "fern" },
    ];
    const answers = new Map([
      ["g-quill", { pullRequests: [{ number: 1 }, { number: 2 }] }],
      ["g-larch", { pullRequests: [] }],
    ]);
    expect(pullWatchGroups(groups, answers).map((group) => group.openPulls)).toEqual([2, 0, 0]);
  });
});

describe("createPullWatch", () => {
  it("asks nothing of a group with no pull request open", async () => {
    const org = rig([repo("appdev", 0)]);
    for (let tick = 0; tick < 4; tick += 1) {
      await org.watch.tick([group(0)]);
      org.advance(PULL_WATCH_MS);
    }
    expect(org.listings).toEqual([]);
  });

  it("costs one listing per watch tick of a group with an open pull request, shared with the minute's pass", async () => {
    const org = rig([repo("appdev", 1), repo("group", 0)]);
    // Ten minutes: the watch every 15 s, the forge pass every 60 s.
    for (let elapsed = 0; elapsed < 10 * 60_000; elapsed += PULL_WATCH_MS) {
      if (elapsed % FORGE_REFRESH_MS === 0) await org.pass();
      await org.watch.tick([group(1)]);
      org.advance(PULL_WATCH_MS);
    }
    // 4 a minute, against 1 without the watch: +3 a minute for the group, whatever it has open.
    expect(org.listings.length).toBe(40);
    expect(org.moved).toEqual([]);
  });

  it("reads a repository's pull requests again within one tick of a merge, once", async () => {
    const org = rig([repo("appdev", 1)]);
    await org.watch.tick([group(1)]);
    org.advance(PULL_WATCH_MS);
    // Merged in another window: the counter drops and `main` moves.
    org.state.listed = [repo("appdev", 0, "2026-10-02T12:00:10Z")];
    await org.watch.tick([group(1)]);
    expect(org.moved).toEqual(["g-quill appdev"]);
    org.advance(PULL_WATCH_MS);
    await org.watch.tick([group(1)]);
    expect(org.moved).toEqual(["g-quill appdev"]);
  });

  it("goes back to the minute's refresh once the merge is read", async () => {
    const org = rig([repo("appdev", 1)]);
    await org.watch.tick([group(1)]);
    org.advance(PULL_WATCH_MS);
    org.state.listed = [repo("appdev", 0)];
    await org.watch.tick([group(1)]);
    const before = org.listings.length;
    for (let tick = 0; tick < 4; tick += 1) {
      org.advance(PULL_WATCH_MS);
      await org.watch.tick([group(0)]);
    }
    expect(org.listings.length).toBe(before);
  });

  it("tells a pull request opened in another repository of the org, too", async () => {
    const org = rig([repo("appdev", 1), repo("apidev", 0)]);
    await org.watch.tick([group(1)]);
    org.advance(PULL_WATCH_MS);
    org.state.listed = [repo("appdev", 1), repo("apidev", 1)];
    await org.watch.tick([group(1)]);
    expect(org.moved).toEqual(["g-quill apidev"]);
  });

  it("starts over for a group that left the watch and came back", async () => {
    const org = rig([repo("appdev", 1)]);
    await org.watch.tick([group(1)]);
    org.advance(PULL_WATCH_MS);
    await org.watch.tick([]);
    // Merged and a new one opened while it was not watched: the minute's pass read both.
    org.state.listed = [repo("appdev", 2)];
    org.advance(PULL_WATCH_MS);
    await org.watch.tick([group(2)]);
    expect(org.moved).toEqual([]);
  });

  it("says nothing when the listing does not answer", async () => {
    const org = rig([repo("appdev", 1)]);
    const failing = createPullWatch({
      reads: createForgeReads({ now: () => NOW }),
      list: () => Promise.reject(new Error("offline")),
      moved: (groupId, repository) => org.moved.push(`${groupId} ${repository}`),
    });
    await expect(failing.tick([group(1)])).resolves.toBeUndefined();
    expect(org.moved).toEqual([]);
  });
});
