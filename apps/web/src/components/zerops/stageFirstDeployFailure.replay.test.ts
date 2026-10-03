/** Origin's first-deploy failure regression, replayed from HQ's pushed deploy records. */
import {
  environmentRow,
  groupFlow,
  listedStopComing,
  type GroupFlowInput,
} from "@t3tools/client-runtime/zerops";
import type { HqDeploy } from "@t3tools/client-runtime/zerops/hq";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { describe, expect, it } from "vite-plus/test";
import { stopLine } from "./projects/projectsView.logic";
import { headingLine } from "./SidebarHeadingLine.logic";

const NOW = Date.parse("2026-10-03T10:00:00Z");
const iso = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const emptyDeploy = {
  failure: null,
  message: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
};
const NONE: Shown<Deployment> = {
  state: "known",
  value: { kind: "none" },
  asOf: { ordinal: 1, atMs: NOW },
  coverage: "complete",
  freshness: { kind: "live" },
};
function said(deploy: HqDeploy, status = "ACTIVE", nowMs = NOW) {
  const services = [{ hostname: "app", status, runtime: true }];
  const row = environmentRow({
    projectId: "stage",
    name: "Acme - stage",
    tier: "stage",
    sources: ["main"],
    keyHeld: true,
    services: [{ hostname: "app", deploy: { latest: deploy, live: null } }],
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
        createdAt: iso(2),
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
    nowMs,
  };
  const stop = groupFlow(input).stages[0]!;
  const coming = listedStopComing(
    "stage",
    { stop, projectStatus: "ACTIVE", createdAt: iso(2), services, building: false, routes: 0 },
    nowMs,
  );
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
  const failure: HqDeploy = {
    ...emptyDeploy,
    sha: "old",
    state: "failed",
    failure: "job",
    message: "The test step failed.",
    at: iso(1),
  };
  it("shows the failed job at once, with its reason, without a forge polling interval", () => {
    expect(said(failure)).toMatchObject({
      first: { kind: "failed", reason: "The test step failed." },
      cell: "First deploy failed",
      line: "Stage didn’t come up · its first deploy failed",
    });
  });
  it("keeps the observed failure after the coming-up window", () => {
    expect(said(failure, "ACTIVE", NOW + 20 * 60_000)).toMatchObject({
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
    expect(said({ ...emptyDeploy, sha: "fix", state: "pending", at: iso(0) })).toMatchObject({
      first: { kind: "on-its-way" },
      cell: "First deploy on its way",
    });
  });
  it("does not call an unclassified refusal a failed build", () => {
    expect(
      said({
        ...emptyDeploy,
        sha: "old",
        state: "failed",
        failure: "refused",
        message: "No workflow",
        at: iso(0),
      }).first,
    ).toBeUndefined();
  });
});
