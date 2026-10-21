import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { GitRefItem } from "@t3tools/shared/hqGitBrowse/refs";
import { makeAccountStore } from "../../data/store.ts";
import { makeGitBrowseReads } from "../../data/adapters/hqGitBrowse.ts";
import { gitBrowse } from "../../data/projections/gitBrowse.ts";
import { HqError } from "../hq/client.ts";
import { refGroups } from "./refGroups.ts";
import { gitBrowsePath } from "./reads.ts";
import { refRevision } from "./refs.ts";

const home: GitHome = {
  sha: "a".repeat(40),
  ref: { name: "main", kind: "branch" },
  about: {
    remote: null,
    mirror: null,
    updatedAt: "2026-10-21T00:00:00.000Z",
    branchCount: 1,
    tagCount: 0,
  },
  readme: null,
};
const key = {
  orgId: "org",
  appId: "app",
  repo: "repo",
  read: "home" as const,
  params: { rev: "main" },
};
function waitFor(store: ReturnType<typeof makeAccountStore>, predicate: () => boolean) {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    const stop = store.subscribe(check);
    check();
  });
}

describe("Git browse reads", () => {
  it("A repository's home is read once for all its holders, and again on a new visit or Again", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const asked: Array<string> = [];
    const reader = makeGitBrowseReads(store, {
      gitBrowseBytes: async () => new Blob(),
      gitBrowse: async (read, appId, repo, params) => {
        asked.push(gitBrowsePath(read, appId, repo, params));
        return home;
      },
    });
    const projected = store.data.project(gitBrowse, { ...key, allowed: true });
    const known = waitFor(store, () => registry.get(projected).state === "known");
    const release = reader.demand(key);
    const second = reader.demand(key);
    await known;
    expect(registry.get(projected)).toMatchObject({ state: "known", answer: home });
    expect(asked).toEqual(["/api/apps/app/repos/repo/browse/home?rev=main"]);
    release();
    second();
    const visited = waitFor(store, () => asked.length === 2);
    const visit = reader.demand(key);
    await visited;
    const asking = waitFor(store, () => asked.length === 3);
    reader.again(key);
    await asking;
    visit();
    reader.close();
    registry.dispose();
  });

  it("A refused read names HQ's reason and is read again only on Again", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let reads = 0;
    const reader = makeGitBrowseReads(store, {
      gitBrowseBytes: async () => new Blob(),
      gitBrowse: async () => {
        reads++;
        throw new HqError({
          kind: "refused",
          code: "commit_not_found",
          message: "No such branch.",
        });
      },
    });
    const projected = store.data.project(gitBrowse, { ...key, allowed: true });
    const refused = waitFor(store, () => registry.get(projected).state === "refused");
    const release = reader.demand(key);
    await refused;
    expect(registry.get(projected)).toEqual({
      state: "refused",
      reason: "commit_not_found",
      words: "No such branch.",
    });
    expect(reads).toBe(1);
    const retried = waitFor(store, () => reads === 2);
    reader.again(key);
    await retried;
    release();
    reader.close();
    registry.dispose();
  });

  it("A read withholds what it holds until access is verified, and once access is denied", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let deny = false;
    const reader = makeGitBrowseReads(store, {
      gitBrowseBytes: async () => new Blob(),
      gitBrowse: async () => {
        if (deny) throw new HqError({ kind: "refused", code: "forbidden", message: "No." });
        return home;
      },
    });
    const projected = store.data.project(gitBrowse, { ...key, allowed: true });
    const known = waitFor(store, () => registry.get(projected).state === "known");
    const release = reader.demand(key);
    await known;
    expect(registry.get(store.data.project(gitBrowse, { ...key, allowed: undefined }))).toEqual({
      state: "withheld",
    });
    deny = true;
    const withheld = waitFor(store, () => registry.get(projected).state === "withheld");
    reader.again(key);
    await withheld;
    release();
    reader.close();
    registry.dispose();
  });

  it("A read's address keeps one order of its parameters", () => {
    expect(gitBrowsePath("refs", "app id", "repo", { limit: 50, q: "fix", kind: "branch" })).toBe(
      "/api/apps/app%20id/repos/repo/browse/refs?kind=branch&limit=50&q=fix",
    );
    expect(gitBrowsePath("home", "app", "repo", {})).toBe("/api/apps/app/repos/repo/browse/home?");
  });
});

const item = (patch: Partial<GitRefItem> & Pick<GitRefItem, "name" | "kind">): GitRefItem => ({
  ref: `refs/heads/${patch.name}`,
  sha: "b".repeat(40),
  committedAt: "2026-10-21T00:00:00.000Z",
  subject: "Subject",
  outsideMate: false,
  ...patch,
});

describe("Ref groups", () => {
  it("Branches, a change's branches and GitHub's branches are grouped apart in HQ's order", () => {
    const items = [
      item({ name: "main", kind: "branch" }),
      item({ name: "release", kind: "github-branch", ref: "refs/github/heads/release" }),
      item({ name: "mate/M/2", kind: "change", change: { mateId: "M", number: 2 } }),
      item({ name: "topic", kind: "branch" }),
    ];
    expect(refGroups(items).map((group) => [group.name, group.items.map((i) => i.name)])).toEqual([
      ["Branches", ["main", "topic"]],
      ["Changes", ["mate/M/2"]],
      ["From GitHub", ["release"]],
    ]);
  });

  it.each([
    [item({ name: "main", kind: "branch" }), "main"],
    [item({ name: "mate/M/2", kind: "change" }), "mate/M/2"],
    [item({ name: "v1", kind: "tag", ref: "refs/tags/v1" }), "refs/tags/v1"],
    [
      item({ name: "main", kind: "github-branch", ref: "refs/github/heads/main" }),
      "refs/github/heads/main",
    ],
  ])("A ref opens by the name that finds it first: %#", (ref, rev) => {
    expect(refRevision(ref)).toBe(rev);
  });
});
