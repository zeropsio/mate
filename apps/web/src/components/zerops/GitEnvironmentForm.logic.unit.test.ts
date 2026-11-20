import type { HqGitAdoption, RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { expect, it } from "vite-plus/test";
import {
  gitSetupBranchValid,
  gitSetupRepository,
  gitSetupReview,
} from "./GitEnvironmentForm.logic.ts";

const shopRemote = {
  url: "https://github.com/acme/shop",
  repositoryId: "501",
  keptAt: "2026-11-02T08:00:00Z",
  keptBy: "member-ada",
  expiresAt: null,
  invalidSince: null,
  via: "token" as const,
  githubAppId: null,
};
const apiRemote = { ...shopRemote, url: "https://github.com/acme/api", repositoryId: "502" };

const shop: RepoListEntry = {
  name: "shop",
  mainHead: "1".repeat(40),
  updatedAt: "2026-11-02T08:00:00Z",
  remote: shopRemote,
};
const api: RepoListEntry = {
  name: "api",
  mainHead: "2".repeat(40),
  updatedAt: "2026-11-02T08:00:00Z",
  remote: apiRemote,
};
const recipe: RepoListEntry = {
  name: RECIPE_REPO,
  mainHead: "3".repeat(40),
  updatedAt: "2026-11-02T08:00:00Z",
};

function reviewOf(repo: RepoListEntry, branch: string): HqGitAdoption {
  return {
    repo: repo.name,
    remote: { url: repo.remote!.url, repositoryId: repo.remote!.repositoryId },
    branch,
    mainHead: repo.mainHead,
    remoteHead: "9".repeat(40),
    changedFiles: 4,
    seed: false,
  };
}

// witness: apps/web/src/components/zerops/GitEnvironmentForm.logic.ts | (roster.length === 1 && roster[0]?.repo.remote == null ? roster[0]?.repo : undefined); → (roster.length === 1 ? roster[0]?.repo : undefined);
it("MN+1: Direct Git setup with an address other than the application's sole connected repository never overwrites it, and an invalid address or a reserved or malformed branch cannot advance setup", () => {
  const other = gitSetupRepository([shop, recipe], "github.com/acme/blog");
  expect(other?.existing).toBeUndefined();
  expect(other?.name).toBe("blog");
  expect(other?.sameRemote).toBe(false);
  expect(other?.connected).toBe(false);

  expect(gitSetupRepository([shop], "https://user:secret@github.com/acme/blog")).toBeUndefined();
  expect(gitSetupRepository([shop], "github.com/acme")).toBeUndefined();
  expect(gitSetupRepository([], `github.com/acme/${RECIPE_REPO}`)).toBeUndefined();

  expect(gitSetupBranchValid("release/next")).toBe(true);
  expect(gitSetupBranchValid("mate/release")).toBe(false);
  expect(gitSetupBranchValid("refs/heads/main")).toBe(false);
  expect(gitSetupBranchValid("release..next")).toBe(false);
});

// witness: apps/web/src/components/zerops/GitEnvironmentForm.logic.ts | review.mainHead === repo.mainHead && →
it("MN+2: Adopting existing code is accepted only with fresh tips of every connected repository, and unread repository evidence is never read as an empty application", () => {
  const roster = [shop, api, recipe];
  expect(gitSetupReview(roster, "live", [reviewOf(shop, "live"), reviewOf(api, "live")])).toBe(
    "ready",
  );

  const movedShop = { ...shop, mainHead: "4".repeat(40) };
  expect(
    gitSetupReview([movedShop, api, recipe], "live", [
      reviewOf(shop, "live"),
      reviewOf(api, "live"),
    ]),
  ).toBe("stale");
  expect(gitSetupReview(roster, "live", [reviewOf(shop, "live")])).toBe("stale");
  expect(gitSetupReview(roster, "live", [reviewOf(shop, "next"), reviewOf(api, "next")])).toBe(
    "stale",
  );

  expect(gitSetupReview(undefined, "live", [reviewOf(shop, "live")])).toBe("unread");
  expect(gitSetupRepository(undefined, "github.com/acme/shop")).toBeUndefined();
  expect(gitSetupReview([recipe], "live", undefined)).toBe("empty");
});
