import { expect, it } from "vite-plus/test";

import { type GitCheckoutState, gitBlock, mateChangeIn } from "./gitTab.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

const change = (
  overrides: Partial<FlowPullRequest> & { readonly number: number },
): FlowPullRequest => ({
  repository: "webdev",
  title: `Change ${overrides.number}`,
  kind: "code",
  mateProjectId: "mate-1",
  url: undefined,
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: undefined,
  baseBranch: "main",
  line: "",
  updatedAt: undefined,
  ...overrides,
});

// witness: packages/client-runtime/src/zerops/gitTab.ts | leaseOfRepository(lease.repo, change.repositoryUrl)); → true);
it("ZV+7: A lease-bound thread reads that lease's repository and, on its branch, only that repository's change, never another application's change on the same branch name", () => {
  const lease = {
    alias: "webpool-1",
    pool: "webpool",
    branch: "feat/invoices",
    repo: "https://hq.example.test/git/org-1/app-1/webdev",
  };
  const pullRequests = [
    change({
      number: 4,
      branch: "feat/invoices",
      repositoryUrl: "https://hq.example.test/git/app-1/webdev",
    }),
    change({
      number: 9,
      branch: "feat/invoices",
      repositoryUrl: "https://hq.example.test/git/app-2/webdev",
    }),
    change({
      number: 11,
      branch: "feat/other",
      repositoryUrl: "https://hq.example.test/git/app-1/webdev",
    }),
  ];
  expect(mateChangeIn({ pullRequests, merged: [] }, "mate-1", "webpool-1", [lease])?.number).toBe(
    4,
  );
});

// witness: packages/client-runtime/src/zerops/gitTab.ts | if (!checkout.hasUpstream || checkout.aheadCount > 0) return "unpushed"; → if (!checkout.hasUpstream) return "unpushed";
it("ZV+8: The Git tab offers Push for an unpushed branch or commits ahead, Update from main only once nothing is left to push, and nothing for a pushed branch without a change or with a merged change", () => {
  const checkout = (
    aheadCount: number,
    behindCount: number,
    hasUpstream: boolean,
  ): GitCheckoutState => ({
    read: true,
    repository: "webdev",
    isRepo: true,
    hasRemote: true,
    headRef: "feat/x",
    aheadCount,
    behindCount,
    hasUpstream,
    changed: [],
  });
  const offered = (state: GitCheckoutState, current: FlowPullRequest | undefined) =>
    gitBlock({
      checkout: state,
      changes: { read: true, change: current },
      declarations: [],
      evidence: { remoteReachable: true },
    }).action?.kind;
  const merged = change({ number: 3, merged: true, mergedAt: "2026-11-01T08:00:00Z" });

  expect([
    offered(checkout(0, 0, false), undefined),
    offered(checkout(2, 3, true), undefined),
    offered(checkout(0, 3, true), undefined),
    offered(checkout(0, 0, true), undefined),
    offered(checkout(0, 3, true), merged),
  ]).toEqual(["push", "push", "update-from-main", undefined, undefined]);
});
