/** Origin's first-deploy failure regression, replayed from HQ's pushed deploy records. */
import {
  environmentRow,
  groupFlow,
  listedStopComing,
  type GroupFlowInput,
} from "@t3tools/client-runtime/zerops";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { describe, expect, it } from "vite-plus/test";
import { stopLine } from "./projects/projectsView.logic";
import { headingLine } from "./SidebarHeadingLine.logic";

const NOW = Date.parse("2026-10-03T10:00:00Z");
const iso = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const emptyDeploy = {
  id: "1",
  kind: "deploy",
  service: "app",
  cause: "merge",
  ref: null,
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  endedAt: null,
  supersededBy: null,
} as const;
const NONE: Shown<Deployment> = {
  state: "known",
  value: { kind: "none" },
  asOf: { ordinal: 1, atMs: NOW },
  coverage: "complete",
  freshness: { kind: "live" },
};
function said(deploy: HqJob, status = "ACTIVE", born = false) {
  const services = [{ hostname: "app", status, runtime: true }];
  const row = environmentRow({
    projectId: "stage",
    name: "Acme - stage",
    tier: "stage",
    sources: ["main"],
    keyHeld: true,
    services: [{ hostname: "app", deploy: { latest: deploy, live: null } }],
    birth: { ended: born },
  });
  const input: GroupFlowInput = {
    groupId: "acme",
    mates: [],
    pullRequests: [],
    merged: [],
    stops: [
      {
        projectId: "stage",
        name: "Acme - stage",
        tier: "stage",
        row,
        deployment: NONE,
        route: undefined,
        projectStatus: "ACTIVE",
        services,
      },
    ],
    missing: [],
    release: {
      gate: { allowed: false, reason: "Nothing merged" },
      suggestion: "v0.1.0",
      waiting: 0,
      waitingAtLeast: false,
      untold: [],
    },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable: false,
    pending: [],
  };
  const stop = groupFlow(input).stages[0]!;
  const coming = listedStopComing("stage", {
    stop,
    projectStatus: "ACTIVE",
    services,
    building: false,
    routes: 0,
  });
  const result = {
    first: stop.firstDeploy,
    cell: stopLine(stop).word,
    line: headingLine(
      {
        production: undefined,
        stages: [{ projectId: "stage", name: "Acme - stage", coming, serves: false }],
        waiting: 0,
        waitingAtLeast: false,
        allOnStage: false,
      },
      undefined,
    ),
  };
  return {
    ...result,
    line:
      result.line === undefined
        ? null
        : [result.line.fact, result.line.rest].filter(Boolean).join(" · "),
  };
}
describe("a first-deploy failure delivered by HQ", () => {
  const failure: HqJob = {
    ...emptyDeploy,
    sha: "old",
    state: "failed",
    reason: "The test step failed.",
    at: iso(1),
    endedAt: iso(1),
  };
  it("shows the failed job at once, with its reason, without a forge polling interval", () => {
    expect(said(failure)).toMatchObject({
      first: { kind: "failed", reason: "The test step failed." },
      cell: "First deploy failed",
      line: "Stage didn’t come up · its first deploy failed",
    });
  });
  it("keeps the observed failure once HQ ended bringing it up", () => {
    expect(said(failure, "ACTIVE", true)).toMatchObject({
      first: { kind: "failed", reason: "The test step failed." },
      cell: "First deploy failed",
    });
  });
  it("shows the import before the failed deploy", () => {
    expect(said(failure, "CREATING")).toMatchObject({
      first: { kind: "setting-up", step: "app" },
      cell: "Setting up a stage…",
      line: "Stage coming up · adding the app",
    });
  });
  it("starts again when HQ queues the newer commit", () => {
    expect(said({ ...emptyDeploy, sha: "fix", state: "queued", at: iso(0) })).toMatchObject({
      first: { kind: "on-its-way" },
      cell: "First deploy on its way",
    });
  });
  // The deploy-jobs design: nothing is tried twice, so HQ's refusal ends the first deploy too.
  it("calls HQ's refusal a failed first deploy, with its words", () => {
    expect(
      said({
        ...emptyDeploy,
        sha: "old",
        state: "refused",
        reason: "stage's deploy token was refused: userUnauthorized",
        at: iso(0),
        endedAt: iso(0),
      }).first,
    ).toEqual({ kind: "failed", reason: "stage's deploy token was refused: userUnauthorized" });
  });
  it("calls nothing failed of a job HQ skipped", () => {
    expect(
      said({
        ...emptyDeploy,
        sha: "old",
        state: "skipped",
        reason: "appdev has no zerops.yaml at 0ld0000",
        at: iso(0),
        endedAt: iso(0),
      }).first,
    ).toBeUndefined();
  });
});
