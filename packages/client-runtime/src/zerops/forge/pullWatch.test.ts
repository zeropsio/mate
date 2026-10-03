import { DateTime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { GiteaRepository } from "../giteaClient.ts";
import { createForgeReads, GATE_FRESH_MS, type RepositoryLists } from "./forgeReads.ts";
import {
  createPullWatch,
  FORGE_REFRESH_MS,
  PULL_WATCH_MS,
  PULL_WATCH_QUIET_MS,
  pullWatchGroups,
  watchedGroups,
  type PullWatchGroup,
} from "./pullWatch.ts";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const LONG_AGO = "2026-10-01T08:00:00Z";
const minutesAgo = (minutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(NOW - minutes * 60_000));

const repo = (name: string, openPulls: number, updatedAt = LONG_AGO): GiteaRepository => ({
  id: name.length,
  name,
  full_name: `org/${name}`,
  default_branch: "main",
  updated_at: updatedAt,
  open_pr_counter: openPulls,
});

/** Orgs on a fake clock: every listing counted by org, every repository the watch says moved kept. */
function rig(orgs: Record<string, Array<GiteaRepository>>) {
  const state = { orgs };
  let clock = NOW;
  const listings: string[] = [];
  const moved: string[] = [];
  const reads = createForgeReads({ now: () => clock });
  const load = async (owner: string) => {
    listings.push(owner);
    return state.orgs[owner] ?? [];
  };
  // What the group readers list: the person's whole account, counted as one listing.
  const lists: RepositoryLists = {
    currentUser: async () => ({ id: 9, login: "u-person" }),
    listAccountRepositories: async () => {
      listings.push("account");
      const repositories = Object.entries(state.orgs).flatMap(([owner, listed]) =>
        listed.map((each) => ({ ...each, full_name: `${owner}/${each.name}` })),
      );
      return { repositories, counts: [repositories.length] };
    },
    listOrganizationRepositories: load,
  };
  const watch = createPullWatch({
    reads,
    list: load,
    moved: (groupId, repository) => moved.push(`${groupId} ${repository}`),
    now: () => clock,
  });
  return {
    state,
    listings,
    moved,
    watch,
    /** The forge pass's read of one org: the shared listing at its usual freshness. */
    pass: (owner: string) => reads.repositories(owner, lists),
    /** The readers' minute tick: every org read again. */
    refresh: (owners: ReadonlyArray<string>) => {
      reads.tick();
      return Promise.all(owners.map((owner) => reads.repositories(owner, lists)));
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const group = (slug: string, openPulls: number, newestPullAt = minutesAgo(1)): PullWatchGroup => ({
  groupId: `g-${slug}`,
  slug,
  openPulls,
  newestPullAt,
});

describe("pullWatchGroups", () => {
  it("counts each group's open pull requests and dates its newest, none while unanswered", () => {
    const groups = [
      { groupId: "g-quill", slug: "quill" },
      { groupId: "g-larch", slug: "larch" },
      { groupId: "g-fern", slug: "fern" },
    ];
    const answers = new Map([
      [
        "g-quill",
        {
          pullRequests: [
            { updatedAt: "2026-10-02T11:50:00Z" },
            { updatedAt: "2026-10-02T11:58:00Z" },
          ],
        },
      ],
      ["g-larch", { pullRequests: [] }],
    ]);
    expect(pullWatchGroups(groups, answers)).toEqual([
      { groupId: "g-quill", slug: "quill", openPulls: 2, newestPullAt: "2026-10-02T11:58:00Z" },
      { groupId: "g-larch", slug: "larch", openPulls: 0, newestPullAt: undefined },
      { groupId: "g-fern", slug: "fern", openPulls: 0, newestPullAt: undefined },
    ]);
  });
});

describe("watchedGroups", () => {
  it.each([
    { case: "nothing open", group: group("quill", 0), watched: false },
    { case: "one open, updated a minute ago", group: group("quill", 1), watched: true },
    {
      case: "open, quiet just under half an hour",
      group: group("quill", 1, minutesAgo(29)),
      watched: true,
    },
    {
      case: "open and quiet for half an hour: back on the minute",
      group: group("quill", 1, minutesAgo(PULL_WATCH_QUIET_MS / 60_000)),
      watched: false,
    },
    {
      case: "open, and nothing dates it",
      group: { ...group("quill", 1), newestPullAt: undefined },
      watched: true,
    },
  ])("$case: watched $watched", ({ group: entry, watched }) => {
    expect(watchedGroups([entry], NOW).length > 0).toBe(watched);
  });

  it("orders the watched groups by their most recently updated pull request", () => {
    const order = watchedGroups(
      [
        group("fern", 1, minutesAgo(9)),
        group("quill", 2, minutesAgo(1)),
        group("larch", 1, minutesAgo(4)),
      ],
      NOW,
    ).map((entry) => entry.slug);
    expect(order).toEqual(["quill", "larch", "fern"]);
  });
});

describe("createPullWatch", () => {
  it("watches faster than the minute's refresh", () => {
    expect(PULL_WATCH_MS).toBeLessThan(FORGE_REFRESH_MS);
  });

  it("asks nothing while no group has a pull request open and moving", async () => {
    const org = rig({ quill: [repo("appdev", 1)], larch: [repo("appdev", 0)] });
    for (let tick = 0; tick < 8; tick += 1) {
      await org.watch.tick([group("quill", 1, minutesAgo(45)), group("larch", 0)]);
      org.advance(PULL_WATCH_MS);
    }
    expect(org.listings).toEqual([]);
  });

  it.each([1, 2, 8])(
    "lists one org a tick with %i groups watched: four a minute at most, however many",
    async (count) => {
      const slugs = Array.from({ length: count }, (_, index) => `org${String(index)}`);
      const org = rig(Object.fromEntries(slugs.map((slug) => [slug, [repo("appdev", 1)]])));
      const groups = slugs.map((slug) => group(slug, 1));
      for (let elapsed = 0; elapsed < 10 * 60_000; elapsed += PULL_WATCH_MS) {
        await org.watch.tick(groups);
        org.advance(PULL_WATCH_MS);
      }
      expect(org.listings.length).toBe((10 * 60_000) / PULL_WATCH_MS);
      // Round the groups: each is looked at every `count` ticks.
      for (const slug of slugs)
        expect(org.listings.filter((owner) => owner === slug).length).toBe(40 / count);
    },
  );

  it("lists its one org on its own, never the whole account", async () => {
    const slugs = Array.from({ length: 14 }, (_, at) => `org${at}`);
    const org = rig(Object.fromEntries(slugs.map((slug) => [slug, [repo("appdev", 1)]])));
    await org.refresh(slugs);
    org.listings.splice(0);
    for (let elapsed = 0; elapsed < FORGE_REFRESH_MS; elapsed += PULL_WATCH_MS) {
      org.advance(PULL_WATCH_MS);
      await org.watch.tick([group("org3", 1)]);
    }
    expect(org.listings).toEqual(["org3", "org3", "org3", "org3"]);
  });

  it.each([
    { name: "another org's", opens: "beta" },
    { name: "the watched org's", opens: "acme" },
  ])(
    "shows $name pull request opened after the watch looked on that org's next tick",
    async ({ opens }) => {
      const org = rig({ acme: [repo("group", 1), repo("app", 0)], beta: [repo("group", 0)] });
      await org.refresh(["acme", "beta"]);
      org.advance(45_000);
      await org.watch.tick([group("acme", 1)]);
      org.advance(5_000);
      const listed = org.state.orgs[opens] ?? [];
      org.state.orgs[opens] = listed.map((each) => ({ ...each, open_pr_counter: 2 }));
      org.advance(10_000);
      const [acme, beta] = await org.refresh(["acme", "beta"]);
      const seen = opens === "acme" ? acme : beta;
      expect(seen?.map((each) => each.open_pr_counter)).toEqual(listed.map(() => 2));
    },
  );

  it("shares the minute's listing: the pass asks nothing the watch just listed", async () => {
    const org = rig({ quill: [repo("appdev", 1)] });
    for (let elapsed = 0; elapsed < 10 * 60_000; elapsed += PULL_WATCH_MS) {
      if (elapsed % FORGE_REFRESH_MS === 0) await org.pass("quill");
      await org.watch.tick([group("quill", 1)]);
      org.advance(PULL_WATCH_MS);
    }
    // One at the start by the pass, then the watch's: 4 a minute, against 1 without it.
    expect(org.listings.length).toBe(40);
  });

  it("looks at the most recently updated group first, then rounds the rest", async () => {
    const org = rig({
      quill: [repo("appdev", 1)],
      larch: [repo("appdev", 1)],
      fern: [repo("appdev", 1)],
    });
    const groups = [
      group("fern", 1, minutesAgo(9)),
      group("quill", 1, minutesAgo(1)),
      group("larch", 1, minutesAgo(4)),
    ];
    for (let tick = 0; tick < 6; tick += 1) {
      await org.watch.tick(groups);
      org.advance(PULL_WATCH_MS);
    }
    expect(org.listings).toEqual(["quill", "larch", "fern", "quill", "larch", "fern"]);
  });

  it.each([
    { watched: 1, withinMs: PULL_WATCH_MS },
    { watched: 2, withinMs: 2 * PULL_WATCH_MS },
  ])(
    "reads a merge within $withinMs ms with $watched watched, once",
    async ({ watched, withinMs }) => {
      const slugs = ["quill", "larch"].slice(0, watched);
      const org = rig(Object.fromEntries(slugs.map((slug) => [slug, [repo("appdev", 1)]])));
      const groups = slugs.map((slug) => group(slug, 1));
      // Every org listed once before the merge.
      for (const _ of slugs) {
        await org.watch.tick(groups);
        org.advance(PULL_WATCH_MS);
      }
      // Merged in another window: the counter drops and `main` moves.
      org.state.orgs.quill = [repo("appdev", 0, "2026-10-02T12:00:10Z")];
      let waited = 0;
      while (org.moved.length === 0 && waited < 10 * PULL_WATCH_MS) {
        await org.watch.tick(groups);
        org.advance(PULL_WATCH_MS);
        waited += PULL_WATCH_MS;
      }
      expect(org.moved).toEqual(["g-quill appdev"]);
      expect(waited).toBeLessThanOrEqual(withinMs);
      for (let tick = 0; tick < 4 * watched; tick += 1) {
        await org.watch.tick(groups);
        org.advance(PULL_WATCH_MS);
      }
      // Once more, and only once: a push this recent is read again on the listing after it
      // (`GATE_SETTLE_MS`), as the minute's pass would read it.
      expect(org.moved).toEqual(["g-quill appdev", "g-quill appdev"]);
    },
  );

  it("tells a pull request opened in another repository of the org, and not a repository gone", async () => {
    const org = rig({ quill: [repo("appdev", 1), repo("apidev", 0), repo("olddev", 0)] });
    await org.watch.tick([group("quill", 1)]);
    org.advance(PULL_WATCH_MS);
    org.state.orgs.quill = [repo("appdev", 1), repo("apidev", 1)];
    await org.watch.tick([group("quill", 1)]);
    expect(org.moved).toEqual(["g-quill apidev"]);
  });

  it("says nothing of an org's first listing, nor of a listing another reader made", async () => {
    const org = rig({ quill: [repo("appdev", 1)] });
    await org.watch.tick([group("quill", 1)]);
    org.advance(PULL_WATCH_MS);
    org.state.orgs.quill = [repo("appdev", 2)];
    // The minute's pass lists first and reads what moved itself.
    org.advance(GATE_FRESH_MS);
    await org.pass("quill");
    await org.watch.tick([group("quill", 1)]);
    expect(org.moved).toEqual([]);
  });

  it("says nothing when the listing does not answer", async () => {
    const moved: string[] = [];
    const failing = createPullWatch({
      reads: createForgeReads({ now: () => NOW }),
      list: () => Promise.reject(new Error("offline")),
      moved: (groupId, repository) => moved.push(`${groupId} ${repository}`),
      now: () => NOW,
    });
    await expect(failing.tick([group("quill", 1)])).resolves.toBeUndefined();
    expect(moved).toEqual([]);
  });
});
