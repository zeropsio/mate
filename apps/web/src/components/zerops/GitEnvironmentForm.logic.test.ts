import { describe, expect, it } from "vite-plus/test";
import type { HqGitAdoption, RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import {
  gitAdoptionSentence,
  gitSetupBranchValid,
  gitSetupExpiry,
  gitSetupRepositories,
  gitSetupReview,
} from "./GitEnvironmentForm.logic";

export const remote = {
  url: "https://github.com/acme/shop",
  repositoryId: "17",
  keptAt: "2026-10-13T10:00:00Z",
  keptBy: "viewer",
  expiresAt: null,
  invalidSince: null,
};
export const repos: ReadonlyArray<RepoListEntry> = [
  { name: "app", mainHead: "a".repeat(40), updatedAt: "2026-10-13T10:00:00Z", remote },
  { name: "worker", mainHead: "b".repeat(40), updatedAt: "2026-10-13T10:00:00Z", remote: null },
  { name: RECIPE_REPO, mainHead: "c".repeat(40), updatedAt: "2026-10-13T10:00:00Z" },
];
export const adoption: HqGitAdoption = {
  repo: "app",
  remote,
  branch: "main",
  mainHead: "a".repeat(40),
  remoteHead: "d".repeat(40),
  changedFiles: 23,
  seed: false,
};

describe("direct Git setup", () => {
  it("lists code repositories and names every repository left out", () => {
    expect(gitSetupRepositories(repos)?.map(({ repo, leftOut }) => [repo.name, leftOut])).toEqual([
      ["app", undefined],
      ["worker", "No verified remote connected."],
    ]);
    expect(gitSetupRepositories(undefined)).toBeUndefined();
  });
  it("requires exact changed-file counts and fresh tips before accepting adoption", () => {
    expect(gitAdoptionSentence(adoption)).toBe(
      "The first push changes 23 files on https://github.com/acme/shop main. Mate's copy wins.",
    );
    expect(gitSetupReview(repos, "main", [adoption])).toBe("ready");
    expect(gitSetupReview(repos, "main", [{ ...adoption, mainHead: "e".repeat(40) }])).toBe(
      "stale",
    );
    expect(gitSetupReview(repos, "stage", [adoption])).toBe("stale");
    expect(
      gitSetupReview(
        repos.map((repo) => (repo.name === "worker" ? { ...repo, remote } : repo)),
        "main",
        [adoption],
      ),
    ).toBe("stale");
    expect(gitSetupReview(repos, "main", [adoption, adoption])).toBe("stale");
  });
  it.each([undefined, [], repos.map((repo) => ({ ...repo, remote: null }))])(
    "does not adopt an unread or unconnected roster",
    (roster) => {
      expect(gitSetupReview(roster, "main", [adoption])).not.toBe("ready");
    },
  );
  it("says a zero file adoption changes nothing", () => {
    expect(gitAdoptionSentence({ ...adoption, changedFiles: 0 })).toBe(
      "The first push changes nothing on https://github.com/acme/shop main.",
    );
  });
  it.each(["main", "staging", "release/next"])("allows the fixed direct branch %s", (branch) =>
    expect(gitSetupBranchValid(branch)).toBe(true),
  );
  it.each(["", "mate/main", "refs/heads/main", "a..b", "@", "main.lock"])(
    "refuses the reserved or malformed branch %s",
    (branch) => expect(gitSetupBranchValid(branch)).toBe(false),
  );
  it.each([
    "https://github.com/acme/shop",
    "https://gitlab.com/team/app",
    "https://code.example/team/app",
  ])("labels unknown expiry once for %s", () =>
    expect(gitSetupExpiry(null)).toBe("Expiry not reported"),
  );
});
