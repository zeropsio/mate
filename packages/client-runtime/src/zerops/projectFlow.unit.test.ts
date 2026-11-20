import { COMPARE_COUNT_MAX } from "@t3tools/shared/hqChanges";
import { expect, it } from "vite-plus/test";

import { type FlowVerb, flowVerbKey, releaseContentsSummary } from "./projectFlow.ts";
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
