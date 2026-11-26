import { expect, it } from "vite-plus/test";

import type { Deployment } from "./flow/deployment.ts";
import { type GroupFlowInput, groupFlow } from "./groupFlow.ts";
import type { Shown } from "./knowledge/known.ts";

const known = (value: Deployment): Shown<Deployment> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});

const production = (deployment: Shown<Deployment>) => ({
  id: "prod-1",
  name: "Production",
  tier: "production" as const,
  row: undefined,
  deployment,
  addresses: [],
});

const base: GroupFlowInput = {
  groupId: "app",
  mates: [],
  pullRequests: [],
  merged: [],
  mainHasCode: true,
  mainHead: undefined,
  pending: [],
  stops: [production(known({ kind: "none" }))],
  release: {
    gate: { allowed: true },
    suggestion: "v0.1.1",
    waiting: 2,
    waitingAtLeast: false,
    untold: [],
  },
};

// witness: packages/client-runtime/src/zerops/groupFlow.ts | state: changeState(pull, now), → state: changeState(pull),
it("ZV198: A project's flow reads an awaiting Review build at its caller's clock; breaks: a project keeps awaiting after the deadline with no new event", () => {
  const until = "2026-11-26T20:30:00Z";
  const pull = {
    repository: "web",
    number: 7,
    title: "Add invoices",
    kind: "code",
    mateProjectId: "mate",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "a".repeat(40),
    baseBranch: "main",
    line: "",
    updatedAt: undefined,
    state: "open",
    ready: true,
    reviewBuild: {
      state: "awaiting",
      head: "a".repeat(40),
      at: "2026-11-26T20:00:00Z",
      until,
    },
  } as const;
  expect(
    [Date.parse(until), Date.parse(until) + 1].map(
      (now) => groupFlow({ ...base, pullRequests: [pull] }, now).pullRequests[0]?.state?.word,
    ),
  ).toEqual([
    "Awaiting Review build",
    "Ready to merge · Review build unavailable (no result arrived)",
  ]);
});

// witness: packages/client-runtime/src/zerops/groupFlow.ts | if (stop.state === "deploying") return { kind: "deploying", stop, line: PRODUCTION_DEPLOYING }; → if (stop.state === "deploying" && candidate === undefined) return { kind: "deploying", stop, line: PRODUCTION_DEPLOYING };
it("ZV139: Release is not offered while a release is in flight, while the platform builds production, or for a production still being created", () => {
  const building = known({
    kind: "deploying",
    version: {
      name: "v0.1.1",
      commit: undefined,
      sha: undefined,
      taggedBy: undefined,
      label: "v0.1.1",
    },
    previous: null,
  });
  expect([
    groupFlow(base).production.kind,
    groupFlow({ ...base, release: { ...base.release, inFlight: "v0.1.0" } }).production.kind,
    groupFlow({ ...base, stops: [production(building)] }).production.kind,
    groupFlow({
      ...base,
      stops: [],
      pending: [{ projectId: "prod-new", kind: "production", name: "Production" }],
    }).production.kind,
  ]).toEqual(["ready-to-release", "releasing", "deploying", "creating"]);
});
