import { expect, it } from "vite-plus/test";
import type { GitOverviewChange, GitOverviewRepository } from "@t3tools/client-runtime/zerops";
import { repositoryChanges, repositoryPage } from "./ZeropsRepositoryBrowser.logic";

// witness: apps/web/src/components/zerops/ZeropsRepositoryBrowser.logic.ts | if (input.allowed === undefined) return { kind: "reading" }; → if (input.allowed === undefined) return { kind: "gone" };
it("MN81: A repository's page is loading until HQ has answered, says the repository is gone when its project or the repository is no longer listed or HQ denies its reads, says the person has no access when HQ's offer refuses, and opens otherwise; breaks: a deleted repository reads as access not verified, or a repository HQ has not answered for reads as gone", () => {
  const base = {
    appsKnown: true,
    appListed: true,
    repositories: ["code"],
    repo: "code",
    allowed: true,
    accessReason: undefined,
    withheld: false,
    homeRefusal: undefined,
  };
  const rows = [
    [{ ...base, appsKnown: false, appListed: false }, { kind: "reading" }],
    [{ ...base, appListed: false }, { kind: "gone" }],
    [
      { ...base, allowed: false, withheld: true },
      { kind: "no-access", reason: "You do not have access to this repository." },
    ],
    [{ ...base, withheld: true }, { kind: "gone" }],
    [{ ...base, homeRefusal: "repo_not_found" }, { kind: "gone" }],
    [{ ...base, homeRefusal: "app_not_found" }, { kind: "gone" }],
    [{ ...base, allowed: undefined }, { kind: "reading" }],
    [{ ...base, repositories: ["other"] }, { kind: "gone" }],
    [base, { kind: "open" }],
    [{ ...base, repositories: undefined }, { kind: "open" }],
    [
      { ...base, allowed: false, accessReason: "HQ refused." },
      { kind: "no-access", reason: "HQ refused." },
    ],
  ] as const;
  for (const [input, expected] of rows) expect(repositoryPage(input)).toEqual(expected);
});

// witness: apps/web/src/components/zerops/ZeropsRepositoryBrowser.logic.ts | if (repository.coverage === "unread") return { kind: "unread" }; → if (repository.coverage === "unread") return { kind: "read", open: [], stale: false };
it("MN89: A repository's Changes tab says its changes are not read until the overview has read them, lists only the open ones, keeps the last read ones marked as such when their read failed, and says none is open only when the read is complete; breaks: a repository whose changes were never read says no change is open", () => {
  const one: GitOverviewChange = {
    pull: {
      repository: "code",
      number: 1,
      title: "One",
      kind: "code",
      mateProjectId: "m1",
      url: undefined,
      mergeability: "mergeable",
      behind: false,
      merged: false,
      mergedAt: undefined,
      state: "open",
      headSha: undefined,
      baseBranch: "main",
      line: "",
      updatedAt: "2026-11-20T00:00:00Z",
      ready: true,
    },
    line: "#1",
    status: undefined,
  };
  const two: GitOverviewChange = {
    pull: { ...one.pull, number: 2, title: "Two", state: "merged", merged: true },
    line: "#2",
    status: undefined,
  };
  const repository: GitOverviewRepository = {
    name: "code",
    changes: [one, two],
    coverage: "complete",
    open: true,
  };
  const rows = [
    [undefined, { kind: "unread" }],
    [{ ...repository, coverage: "unread" }, { kind: "unread" }],
    [
      { ...repository, coverage: "failed" },
      { kind: "read", open: [one], stale: true },
    ],
    [
      { ...repository, coverage: "failed", changes: [] },
      { kind: "read", open: [], stale: true },
    ],
    [repository, { kind: "read", open: [one], stale: false }],
    [
      { ...repository, changes: [] },
      { kind: "read", open: [], stale: false },
    ],
  ] as const;
  for (const [input, expected] of rows) expect(repositoryChanges(input)).toEqual(expected);
});
