import { COMPARE_COUNT_MAX, type HqChange } from "@t3tools/shared/hqChanges";
import type { HqNavigationChange } from "@t3tools/shared/hqStream";
import { expect, it } from "vite-plus/test";

import {
  type FlowVerb,
  flowVerbKey,
  releaseContentsSummary,
  flowAppChanges,
  changeState,
} from "./projectFlow.ts";
import type { Moved } from "./releaseCompare.ts";

// witness: packages/client-runtime/src/zerops/projectFlow.ts | return `${verb.kind} ${verb.groupId}/${verb.projectId}/${verb.service}`; → return `redeploy ${verb.groupId}/${verb.projectId}/${verb.service}`;
it("ZV142: A verb in flight is keyed by its own target: one row's Merge is no other row's, and a deploy asked again is keyed apart from a service added", () => {
  const verbs: ReadonlyArray<FlowVerb> = [
    { kind: "merge", groupId: "app", repository: "webdev", number: 4 },
    { kind: "merge", groupId: "app", repository: "webdev", number: 5 },
    { kind: "merge", groupId: "app", repository: "apidev", number: 4 },
    { kind: "close", groupId: "app", repository: "webdev", number: 4 },
    { kind: "redeploy", groupId: "app", projectId: "p1", service: "api" },
    { kind: "add-service", groupId: "app", projectId: "p1", service: "api" },
  ];
  expect(new Set(verbs.map(flowVerbKey)).size).toBe(verbs.length);
  expect(flowVerbKey({ kind: "merge", groupId: "app", repository: "webdev", number: 4 })).toBe(
    flowVerbKey(verbs[0]!),
  );
});

const commit = (sha: string, subject: string) => ({
  sha,
  subject,
  authorName: "Nova",
  at: "2026-11-01T08:00:00Z",
  change: null,
});

// witness: packages/client-runtime/src/zerops/projectFlow.ts |     atLeast, →     atLeast: false,
it("ZV143: A release's contents count each change once however many services take it, and say at least where HQ stopped counting", () => {
  const commits = [commit("1".repeat(40), "Add invoices"), commit("2".repeat(40), "Fix totals")];
  const shared: ReadonlyArray<Moved> = [
    { repository: "api", services: ["api"], commits, total: 2, truncated: false },
    { repository: "api", services: ["worker"], commits, total: 2, truncated: false },
  ];
  expect(releaseContentsSummary(shared)).toEqual({
    subjects: ["Add invoices", "Fix totals"],
    more: 0,
    total: 2,
    atLeast: false,
  });

  const counted = releaseContentsSummary([
    ...shared,
    {
      repository: "web",
      services: ["web"],
      commits: [],
      total: COMPARE_COUNT_MAX,
      truncated: true,
    },
  ]);
  expect([counted.total, counted.atLeast]).toEqual([COMPARE_COUNT_MAX + 2, true]);
});

// witness: packages/client-runtime/src/zerops/projectFlow.ts | ...(change.reviewBuild !== undefined ? { reviewBuild: change.reviewBuild } : {}), → ...(change.reviewBuild === undefined ? { reviewBuild: change.reviewBuild } : {}),
it("ZV196: A change read from navigation alone carries its addition result and given-up decision into its row; breaks: a failed addition without a GitHub pull request reads as running", () => {
  const build = { head: "a".repeat(40), at: "2026-11-26T20:00:00Z", state: "failing" } as const;
  const result = flowAppChanges({
    appId: "app",
    hqAddress: "https://hq.example.test",
    detail: undefined,
    open: [
      {
        repo: "web",
        number: 7,
        mateProjectId: "mate",
        title: "Add invoices",
        state: "adding",
        hasHead: true,
        updatedAt: "2026-11-26T20:00:00Z",
        mergeability: "clean",
        ready: true,
        reviewBuild: build,
        checksGivenUp: { reason: "tries" },
      },
    ],
  });
  expect(result.pullRequests[0]?.reviewBuild).toEqual(build);
  expect(result.pullRequests[0]?.checksGivenUp).toEqual({ reason: "tries" });
  expect(
    changeState(
      { ...result.pullRequests[0]!, checksGivenUp: undefined },
      Date.parse("2026-11-26T20:10:00Z"),
    )?.tone,
  ).toBe("attention");
});

// witness: packages/client-runtime/src/zerops/projectFlow.ts | .filter((change) => isActiveChange(change.state) && change.head !== null) → .filter((change) => change.state === "open" && change.head !== null)
it("ZV206: A draft stays visible and says it is being added while HQ builds or merges it; breaks: the change vanishes or reads ready to add again.", () => {
  const head = "a".repeat(40);
  const base = {
    repo: "web",
    number: 7,
    mateProjectId: "mate",
    title: "Add a guestbook",
    state: "open",
    updatedAt: "2026-11-27T09:00:00Z",
    mergeability: "clean",
    ready: true,
  } as const;
  for (const state of ["open", "adding", "merging"] as const) {
    const row = { ...base, state };
    const report = {
      state: "failing",
      head,
      main: "b".repeat(40),
      take: "take-1",
      try: 2,
      at: row.updatedAt,
      parts: [{ part: "webstage", setup: "web", stage: "web.example", outcome: "failed" }],
    } as const;
    const navigation: HqNavigationChange = {
      ...row,
      hasHead: true,
      reviewBuild: report,
    };
    expect(navigation.reviewBuild).toEqual(report);
    const detail: HqChange = {
      ...row,
      appId: "app",
      branch: "guestbook",
      body: "A guestbook",
      head,
      mergedSha: null,
      landedHead: null,
      openedAt: row.updatedAt,
      mergedAt: null,
      closedAt: null,
      behind: false,
      comments: 0,
      receipt: null,
    };
    const projected = flowAppChanges({
      appId: "app",
      hqAddress: "https://hq.example.test",
      open: [navigation],
      detail: [detail],
    }).pullRequests;
    expect(projected.map((change) => [change.number, change.state, change.headSha])).toEqual([
      [7, state, head],
    ]);
    expect(projected[0]?.reviewBuild).toEqual(report);
    if (state !== "open") {
      expect(changeState(projected[0]!)?.tone).toBe(state === "adding" ? "attention" : "busy");
      const staleDetail = { ...detail, state: "open" as const };
      const current = flowAppChanges({
        appId: "app",
        hqAddress: "https://hq.example.test",
        open: [navigation],
        detail: [staleDetail],
      }).pullRequests;
      expect(current.map((change) => [change.state, change.headSha])).toEqual([[state, head]]);
    }
  }
});
