import { expect, it } from "vite-plus/test";
import type { GitRepositoryFacts } from "@t3tools/client-runtime/zerops";
import { repositoryWhere } from "./ZeropsGitPage.logic";

const remote = (url: string): NonNullable<GitRepositoryFacts["remote"]> => ({
  url,
  repositoryId: null,
  keptAt: "2026-11-20T00:00:00Z",
  keptBy: "p1",
  expiresAt: null,
  invalidSince: null,
  via: "token",
  githubAppId: null,
});
const updatedAt = "2026-11-20T00:00:00Z";

// witness: apps/web/src/components/zerops/ZeropsGitPage.logic.ts | if (address === undefined) return "Only in Mate"; → if (address === undefined || githubName(address) === null) return "Only in Mate";
it("MN79: A repository's row says where its code also lives from its remote on any host, else what it follows, else that it is only in Mate; breaks: a repository on another host than GitHub reads as only in Mate", () => {
  expect(repositoryWhere({ updatedAt, remote: remote("https://github.com/acme/app.git") })).toBe(
    "GitHub acme/app",
  );
  expect(repositoryWhere({ updatedAt, remote: remote("https://gitlab.com/team/app.git") })).toBe(
    "GitLab team/app",
  );
  expect(
    repositoryWhere({ updatedAt, remote: remote("https://git.example.com/team/app.git") }),
  ).toBe("git.example.com team/app");
  expect(repositoryWhere({ updatedAt, follows: "https://github.com/acme/app.git" })).toBe(
    "Follows GitHub acme/app",
  );
  expect(repositoryWhere({ updatedAt })).toBe("Only in Mate");
  expect(repositoryWhere(undefined)).toBeUndefined();
});
