/** Replay of origin's import/build boundaries with HQ deploy records replacing runner and forge statuses. */
import {
  environmentRow,
  groupFlow,
  listedStopComing,
  stopServes,
  type FlowPullRequest,
  type GroupFlowInput,
} from "@t3tools/client-runtime/zerops";
import {
  stopDeploymentOf,
  stopServices,
  stopVerdict,
  stopView,
  unnamedVersions,
  type Deployment,
  type StopReads,
} from "@t3tools/client-runtime/zerops/flow";
import {
  deployed,
  project,
  record,
  runningBuild,
  servicesRead,
  work,
} from "@t3tools/client-runtime/zerops/flow/fixtures";
import type { ServiceDeployInfo } from "@t3tools/client-runtime/zerops/data";
import type { ZeropsServiceDeployedVersion } from "@t3tools/client-runtime/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import { stopLine } from "./projects/projectsView.logic";
import { stageMenu } from "./SidebarProductionChip.logic";
import { declaredEnvironmentSummary } from "./ZeropsProjectsPage";
import { headingLine, type HeadingLineInput } from "./SidebarHeadingLine.logic";

const START = Date.parse("2026-10-02T21:56:00.000Z");
const at = (seconds: number) => START + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

const STAGE_ID = "p-abacus-stage";
const FIX = "5d0e7a19c4b2f83e6a1d09c7b5e4f3a2d1c0b9e8";

const known = (value: Deployment): Shown<Deployment> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});
const NONE = known({ kind: "none" });

/** The stage's runtime before its first deploy: the import's `NONE` version runs nothing. */
const IMPORTED: ServiceDeployInfo = {
  id: "version-1",
  status: "ACTIVE",
  source: "NONE",
  activatedAt: "2026-10-02T22:07:58Z",
  name: null,
  branch: null,
  commit: null,
  tag: null,
  repository: null,
};

/**
 * The first build's end, in the order run 5 saw it (window B): the build running, its process gone
 * (+1096.1 s), the listing read again with the new version active and stated by nothing yet
 * (+1096.4 s), then the organization's active versions and the service's variables stating it
 * (+1097.6 s). What the stop reads at each step is what every surface is handed.
 */
function firstBuild() {
  const stage = project(STAGE_ID);
  const listed = (deploy: ServiceDeployInfo) =>
    servicesRead([record("app-id", "app", deployed(deploy), { project: stage })], {
      project: stage,
    });
  const imported = {
    id: "version-1",
    projectId: STAGE_ID,
    serviceId: "app-id",
    status: "ACTIVE",
    source: "NONE",
  };
  let services = listed(IMPORTED);
  let held = work({ active: { "app-id": imported } });
  let versions: StopReads["versions"] = new Map();
  let stated: Shown<ZeropsServiceDeployedVersion> = { state: "unread", waitingFor: null };
  const step = (t: number, change: () => void) => {
    change();
    return stopDeploymentOf(
      stopServices(
        {
          services,
          work: held,
          versions,
          refused: null,
          stated: new Map(
            unnamedVersions(services, held.names).map(({ versionId }) => [versionId, stated]),
          ),
          detail: false,
        },
        at(t),
      ),
    );
  };
  // The build is named by the commit it builds as the platform reads its pipeline.
  const named = `main ${FIX.slice(0, 7)}`;
  const building = step(1033.9, () => {
    held = work({
      active: { "app-id": imported },
      builds: [runningBuild(["build-helper", "app-id"], { id: "version-2", name: named })],
      names: { "version-2": named },
    });
  });
  const ended = step(1096.1, () => {
    held = work({
      active: { "app-id": imported },
      names: { "version-2": named },
      lastBuilds: { "app-id": { processId: "build", status: "FINISHED" } },
    });
  });
  const unstated = step(1096.4, () => {
    services = listed({ ...IMPORTED, id: "version-9", source: null });
  });
  const running = step(1097.6, () => {
    const version = { ...imported, id: "version-9", source: "GIT" };
    held = { ...held, active: { "app-id": version } };
    versions = new Map([["version-9", { kind: "known", source: "GIT" }]]);
    stated = {
      state: "known",
      value: { activeId: "version-9", source: "GIT", name: named },
      asOf: { ordinal: 2, atMs: at(1097.6) },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  });
  return { building, ended, unstated, running };
}
const BUILD = firstBuild();

/** HQ records the deploy it queued and the final failed job, without a forge read. */
const FIRST = "8f7e6d5c4b3a29180f7e6d5c4b3a291807f6e5d4";
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
const queued = (sha = FIRST, seconds = 690): HqJob => ({
  ...emptyDeploy,
  sha,
  state: "queued",
  at: iso(seconds),
});
const FAILED_ON_MAIN: HqJob = {
  ...emptyDeploy,
  sha: FIRST,
  state: "failed",
  at: iso(690),
  endedAt: iso(772.7),
};
const pull = (number: number, mergedAt: number): FlowPullRequest => ({
  repository: "appdev",
  number,
  title: "Count the beads",
  behind: false,
  kind: "code",
  mateProjectId: "p-abacus-mate",
  url: undefined,
  mergeability: "mergeable",
  merged: true,
  mergedAt: iso(mergedAt),
  headSha: "c0ffee1",
  baseBranch: "main",
  line: `appdev #${String(number)}`,
  updatedAt: iso(mergedAt),
});

const app = (status: string) => ({ hostname: "app", status, runtime: true });

interface Moment {
  readonly t: number;
  readonly projectStatus?: string;
  /** As the candidate listing holds them: none while the project is not active. */
  readonly services?: ReadonlyArray<ReturnType<typeof app>>;
  readonly deployment: Shown<Deployment> | undefined;
  readonly routes?: number;
  /** The code changes merged by then. */
  readonly merged?: ReadonlyArray<FlowPullRequest>;
  /** HQ's deploy job of `main`'s head of `appdev`, as the deploy half last read it. */
  readonly deploy?: HqJob;
  /** Whether HQ ended bringing it up (`HqEnvironment.birth`); still bringing it up unless said. */
  readonly born?: boolean;
}

/** What the menu's line and the page's cell say at one moment. */
function said(moment: Moment) {
  const nowMs = at(moment.t);
  const projectStatus = moment.projectStatus ?? "ACTIVE";
  const services = moment.services ?? [app("ACTIVE")];
  const row = environmentRow({
    projectId: STAGE_ID,
    name: "Abacus - stage",
    tier: "stage",
    sources: ["main"],
    services: [
      {
        hostname: "app",
        repository: "appdev",
        deploy: { latest: moment.deploy ?? queued(), live: null },
      },
    ],
    keyHeld: true,
    birth: { ended: moment.born === true },
  });
  const input: GroupFlowInput = {
    groupId: "g-abacus",
    mates: [],
    pullRequests: [],
    merged: moment.merged ?? [pull(1, 642.3)],
    stops: [
      {
        projectId: STAGE_ID,
        name: "Abacus - stage",
        tier: "stage",
        row,
        deployment: moment.deployment,
        route: undefined,
        projectStatus,
        services,
      },
    ],
    release: {
      gate: { allowed: false, reason: "Nothing is merged to release." },
      suggestion: "v0.1.0",
      waiting: 0,
      waitingAtLeast: false,
      untold: [],
    },
    mainHasCode: undefined,
    mainHead: undefined,
    pending: [],
  };
  const stop = groupFlow(input).stages[0];
  if (stop === undefined) throw new Error("the stage is listed");
  const listed = {
    stop,
    projectStatus,
    services,
    building: moment.deployment?.state === "known" && moment.deployment.value.kind === "deploying",
    routes: moment.routes ?? 0,
  };
  const heading: HeadingLineInput = {
    production: undefined,
    stages: [
      {
        projectId: STAGE_ID,
        name: "Abacus - stage",
        coming: listedStopComing("stage", listed),
        serves: stopServes(listed),
        building: false,
      },
    ],
    waiting: 0,
    waitingAtLeast: false,
    allOnStage: false,
  };
  const line = headingLine(heading, undefined);
  const cell = stopLine(stop);
  const view = stopView({
    deployment: moment.deployment ?? { state: "unread", waitingFor: null },
    row,
    nowMs,
  });
  return {
    line: line === undefined ? null : [line.fact, line.rest].filter(Boolean).join(" · "),
    cell: [cell.word, cell.version].filter(Boolean).join(" "),
    // The other surfaces that say a stage's first deploy: the expanded row, the stage chip's
    // menu and the stage's own page.
    others: {
      summary: declaredEnvironmentSummary(row, stop.firstDeploy),
      chipMenu:
        stageMenu({
          stages: [
            {
              projectId: STAGE_ID,
              name: "stage",
              stop,
              chip: undefined,
              deployedAt: undefined,
              down: [],
              routes: [],
            },
          ],
          creating: [],
          nowMs,
        }).stops[0]?.word ?? "",
      page: stopVerdict({
        tier: "stage",
        view,
        releasing: undefined,
        failed: undefined,
        waiting: 0,
        release: { offered: false, tag: undefined, reason: undefined },
        releasedAge: undefined,
        since: undefined,
        atMainHead: false,
        waitingAtLeast: false,
        untold: [],
        keyGap: undefined,
        firstDeploy: stop.firstDeploy,
      }).text,
    },
  };
}

/** The phase another surface's words name, before the first build. */
function otherPhase(words: string): string {
  if (words.startsWith("Setting up")) return "import";
  if (words.startsWith("First deploy on its way")) return "on its way";
  if (words.startsWith("Nothing deployed yet") || words.startsWith("Not deployed yet"))
    return "awaited";
  if (words.startsWith("First deploy failed")) return "failed";
  return `unknown: ${words}`;
}

/** The phase a menu line names. */
function linePhase(line: string | null): string {
  if (line === null) return "up";
  if (/making the project|adding the database|adding the app/u.test(line)) return "import";
  if (line.includes("first deploy on its way")) return "on its way";
  if (line.includes("awaiting a first deploy")) return "awaited";
  if (line.includes("its first deploy failed")) return "failed";
  if (line.includes("building the app")) return "building";
  if (line.includes("turning its address on")) return "up";
  return `unknown: ${line}`;
}

/** The phase a cell names. */
function cellPhase(cell: string): string {
  if (cell === "Setting up a stage…") return "import";
  if (cell === "First deploy on its way") return "on its way";
  if (cell === "Nothing deployed yet") return "awaited";
  if (cell === "First deploy failed") return "failed";
  if (cell.startsWith("Deploying…")) return "building";
  if (cell.startsWith("Deployed")) return "up";
  return `unknown: ${cell}`;
}

describe("a stage's first deploy, replayed as run 5 measured it", () => {
  const moments: ReadonlyArray<Moment & { readonly line: string | null; readonly cell: string }> = [
    {
      t: 682.1,
      projectStatus: "CREATING",
      services: [],
      deployment: undefined,

      line: "Stage coming up · making the project",
      cell: "Setting up a stage…",
    },
    {
      // The project listed active, its app not listed yet: still being made.
      t: 696.1,
      services: [],
      deployment: NONE,

      line: "Stage coming up · adding the app",
      cell: "Setting up a stage…",
    },
    {
      // The import's own no-code deploy runs (+699.5 → +710.5 s): still the import, not a first deploy.
      t: 700.8,
      services: [app("CREATING")],
      deployment: NONE,

      line: "Stage coming up · adding the app",
      cell: "Setting up a stage…",
    },
    {
      t: 712.6,
      deployment: NONE,

      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 730,
      deployment: NONE,

      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 750,
      deployment: NONE,

      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      // The failure posted, and read on the deploy half's next minute.
      t: 790,
      deployment: NONE,

      deploy: FAILED_ON_MAIN,
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    },
    {
      // Where the pass-34 bound held "on its way" for up to 15 minutes.
      t: 1000,
      deployment: NONE,

      deploy: FAILED_ON_MAIN,
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    },
    {
      // The fix merged: main's new head has nothing on it yet (read at once for a merge pressed
      // here, on the deploy half's next minute for one pressed elsewhere).
      t: 1025,
      deployment: NONE,
      merged: [pull(1, 642.3), pull(2, 1010.9)],

      deploy: queued(FIX, 1011),
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 1033.9,
      deployment: BUILD.building,
      merged: [pull(1, 642.3), pull(2, 1010.9)],

      line: "Stage coming up · building the app",
      cell: "Deploying… 5d0e7a1",
    },
    {
      // N3: the build's process left, Zerops ended it FINISHED, its version not active yet:
      // nothing runs, and HQ's job of it has not ended — no clock holds the build's word.
      t: 1096.1,
      services: [app("UPGRADING")],
      deployment: BUILD.ended,
      merged: [pull(1, 642.3), pull(2, 1010.9)],

      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      // N3: read again, its new version active and stated by nothing yet.
      t: 1096.4,
      deployment: BUILD.unstated,
      merged: [pull(1, 642.3), pull(2, 1010.9)],

      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 1097.6,
      deployment: BUILD.running,
      merged: [pull(1, 642.3), pull(2, 1010.9)],

      line: "Stage coming up · turning its address on",
      cell: "Deployed 5d0e7a1",
    },
    {
      t: 1100.7,
      deployment: BUILD.running,
      routes: 1,
      merged: [pull(1, 642.3), pull(2, 1010.9)],

      line: null,
      cell: "Deployed 5d0e7a1",
    },
  ];

  it.each(moments)("+$t s", ({ line, cell, ...moment }) => {
    const { others: _others, ...now } = said(moment);
    expect(now).toEqual({ line, cell });
  });

  it("names the same phase on every surface until the first build", () => {
    for (const { line: _line, cell: _cell, ...moment } of moments) {
      if (moment.deployment?.state === "known" && moment.deployment.value.kind !== "none") continue;
      const now = said(moment);
      const phase = linePhase(now.line);
      expect({ t: moment.t, phases: Object.values(now.others).map(otherPhase) }).toEqual({
        t: moment.t,
        phases: [phase, phase, phase],
      });
    }
  });

  it("names the same phase on the menu and the cell at every moment", () => {
    for (const { line: _line, cell: _cell, ...moment } of moments) {
      const now = said(moment);
      expect({ t: moment.t, phase: cellPhase(now.cell) }).toEqual({
        t: moment.t,
        phase: linePhase(now.line),
      });
    }
  });
});

describe("HQ's job fails before the import finishes", () => {
  it("shows the import first and the failed deploy as soon as it ends", () => {
    expect(
      said({ t: 700.8, services: [app("CREATING")], deployment: NONE, deploy: FAILED_ON_MAIN }),
    ).toMatchObject({ line: "Stage coming up · adding the app", cell: "Setting up a stage…" });
    expect(said({ t: 790, deployment: NONE, deploy: FAILED_ON_MAIN })).toMatchObject({
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    });
  });
});
