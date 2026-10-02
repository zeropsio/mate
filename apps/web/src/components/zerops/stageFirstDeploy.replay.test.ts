/**
 * A stage's first deploy, replayed as run 5 measured it (2–3 Oct 2026), under invented names: the
 * menu's heading line (`listedStopComing` → `headingLine`) and the projects page's stage cell
 * (`groupFlow` → `stopLine`), step by step. At every moment both name the same phase.
 *
 * The run: code landed on `main` at +642.3 s; the group's runner was imported at +651.5 s and
 * stood READY_TO_DEPLOY; the stage's project was made at +670.4 s and its import ran until
 * +710.5 s (the project ACTIVE by ~+700 s, the app NEW → CREATING at ~+700 s → ACTIVE at +710.5 s);
 * the runner was built +723.8 → +749.2 s; at +772.7 s the deploy job failed in the workflow's own
 * Test step, before it asked the broker for its grant — the failure only on `main`'s head; the fix
 * merged at +1010.9 s; the first build ran +1033.8 → +1097.3 s and the address turned on at
 * +1097.3 s.
 */
import {
  environmentRow,
  groupFlow,
  groupRunner,
  listedStopComing,
  stopServes,
  type FlowPullRequest,
  type GroupFlowInput,
  type MainHeadStatuses,
} from "@t3tools/client-runtime/zerops";
import {
  makeDeploymentStore,
  stopDeploymentOf,
  stopVerdict,
  stopView,
  type Deployment,
} from "@t3tools/client-runtime/zerops/flow";
import {
  deployed,
  processesRead,
  project,
  record,
  runningProcess,
  servicesRead,
} from "@t3tools/client-runtime/zerops/flow/fixtures";
import type { ServiceDeployInfo } from "@t3tools/client-runtime/zerops/data";
import type { ZeropsServiceDeployedVersion } from "@t3tools/client-runtime/zerops/data";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { describe, expect, it } from "vite-plus/test";

import { stopLine } from "./projects/projectsView.logic";
import { stageMenu } from "./SidebarProductionChip.logic";
import { declaredEnvironmentSummary } from "./ZeropsProjectsPage";
import { headingLine, type HeadingLineInput } from "./SidebarHeadingLine.logic";

const START = Date.parse("2026-10-02T21:56:00.000Z");
const at = (seconds: number) => START + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

const STAGE_ID = "p-abacus-stage";
const MADE = 670.4;
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
 * The first build's end, through the deployment store in the order run 5 saw it (window B): the
 * build running, its process gone (+1096.1 s), the listing read again with the new version active
 * and stated by nothing yet (+1096.4 s), then the account's store stating it (+1097.6 s). What the
 * store answers at each step is what every surface is handed.
 */
function firstBuild() {
  const stage = project(STAGE_ID);
  const listed = (deploy: ServiceDeployInfo) =>
    servicesRead([record("app-id", "app", deployed(deploy), { project: stage })], {
      project: stage,
    });
  const build = processesRead(
    [
      runningProcess("build-1", {
        serviceIds: ["build-helper", "app-id"],
        appVersion: { id: "version-2", status: "BUILDING" },
        project: stage,
      }),
    ],
    { project: stage },
  );
  let services = listed(IMPORTED);
  let processes = build;
  let stated: Shown<ZeropsServiceDeployedVersion> = { state: "unread", waitingFor: null };
  let changed = () => undefined as void;
  const clock = { ms: at(1033.9) };
  const store = makeDeploymentStore({
    services: () => services,
    processes: () => processes,
    deployedVersion: () => stated,
    follow: (_project, listener) => {
      changed = listener;
      return () => undefined;
    },
    nowMs: () => clock.ms,
    random: () => 0.5,
    setTimer: () => () => undefined,
  });
  store.demand(stage);
  const step = (t: number, change: () => void) => {
    clock.ms = at(t);
    change();
    changed();
    return stopDeploymentOf(store.stop(stage));
  };
  // The build is named by the commit it builds as the platform reads its pipeline.
  const building = step(1033.9, () => {
    processes = processesRead(
      [
        runningProcess("build-1", {
          serviceIds: ["build-helper", "app-id"],
          appVersion: { id: "version-2", name: `main ${FIX.slice(0, 7)}`, status: "BUILDING" },
          project: stage,
        }),
      ],
      { project: stage },
    );
  });
  const ended = step(1096.1, () => {
    processes = processesRead([], { project: stage });
  });
  const unstated = step(1096.4, () => {
    services = listed({ ...IMPORTED, id: "version-9", source: null });
  });
  const running = step(1097.6, () => {
    stated = {
      state: "known",
      value: { activeId: "version-9", source: "GIT", name: `main ${FIX.slice(0, 7)}` },
      asOf: { ordinal: 2, atMs: at(1097.6) },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  });
  return { building, ended, unstated, running };
}
const BUILD = firstBuild();

/** `main` after the first merge: the broker's deploy asked for, and the workflow's run on it. */
const FIRST = "8f7e6d5c4b3a29180f7e6d5c4b3a291807f6e5d4";
const ASKED = { context: "mate/deploy/abacus-stage/app", state: "pending", created_at: iso(690) };
const head = (sha: string, ...statuses: ReadonlyArray<object>): MainHeadStatuses => ({
  sha,
  statuses: statuses as MainHeadStatuses["statuses"],
});
/** +772.7 s: the workflow's Test step failed on the bare runner; the broker was never asked. */
const FAILED_ON_MAIN = head(
  FIRST,
  {
    context: "Zerops deploy / deploy (push)",
    state: "failure",
    description: "Failing after 11s",
    created_at: iso(772.7),
  },
  ASKED,
);

const pull = (number: number, mergedAt: number): FlowPullRequest => ({
  repository: "appdev",
  number,
  title: "Count the beads",
  kind: "code",
  mateProjectId: "p-abacus-mate",
  author: "mate-p-abacus-mate",
  url: undefined,
  checks: "none",
  checkWord: undefined,
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
  /** The runner's status in the Gitea project. */
  readonly runner: string;
  /** The code changes merged by then. */
  readonly merged?: ReadonlyArray<FlowPullRequest>;
  /** `main`'s head of `appdev` and its statuses, as the deploy half last read them. */
  readonly head?: MainHeadStatuses;
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
        ...(moment.head === undefined ? {} : { head: moment.head }),
      },
    ],
    environment: "abacus-stage",
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
        createdAt: iso(MADE),
        projectStatus,
        services,
      },
    ],
    missing: [],
    release: {
      gate: { allowed: false, reason: "Nothing is merged to release." },
      suggestion: "v0.1.0",
      waiting: 0,
    },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable: false,
    pending: [],
    runner: groupRunner({
      slug: "abacus",
      services: [{ name: "runnerabacus", status: moment.runner }],
    }),
    nowMs,
  };
  const stop = groupFlow(input).stages[0];
  if (stop === undefined) throw new Error("the stage is listed");
  const listed = {
    stop,
    projectStatus,
    createdAt: iso(MADE),
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
        coming: listedStopComing("stage", listed, nowMs),
        serves: stopServes(listed),
      },
    ],
    waiting: 0,
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
        release: { offered: false, tag: undefined },
        releasedAge: undefined,
        since: undefined,
        atMainHead: false,
        firstDeploy: stop.firstDeploy,
      }).text,
    },
  };
}

/** The phase another surface's words name, before the first build. */
function otherPhase(words: string): string {
  if (words.startsWith("Setting up")) return "import";
  if (words.startsWith("Waiting for the runner"))
    return `runner: ${words.split(" · ")[1]?.replace(/\.$/u, "") ?? ""}`;
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
  if (line.includes("awaits the runner")) return `runner: ${line.split(" · ")[1] ?? ""}`;
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
  if (cell.startsWith("Waiting for the runner")) return `runner: ${cell.split(" · ")[1] ?? ""}`;
  if (cell === "First deploy on its way") return "on its way";
  if (cell === "Nothing deployed yet") return "awaited";
  if (cell === "First deploy failed") return "failed";
  if (cell.startsWith("Deploying…")) return "building";
  if (cell.startsWith("Deployed")) return "up";
  return `unknown: ${cell}`;
}

const READY = "READY_TO_DEPLOY";

describe("a stage's first deploy, replayed as run 5 measured it", () => {
  const moments: ReadonlyArray<Moment & { readonly line: string | null; readonly cell: string }> = [
    {
      t: 682.1,
      projectStatus: "CREATING",
      services: [],
      deployment: undefined,
      runner: READY,
      line: "Stage coming up · making the project",
      cell: "Setting up a stage…",
    },
    {
      // The project listed active, its app not listed yet: still being made, never the runner.
      t: 696.1,
      services: [],
      deployment: NONE,
      runner: READY,
      line: "Stage coming up · adding the app",
      cell: "Setting up a stage…",
    },
    {
      // The import's own no-code deploy runs (+699.5 → +710.5 s): the cell said the runner.
      t: 700.8,
      services: [app("CREATING")],
      deployment: NONE,
      runner: READY,
      line: "Stage coming up · adding the app",
      cell: "Setting up a stage…",
    },
    {
      t: 712.6,
      deployment: NONE,
      runner: READY,
      line: "Stage awaits the runner · it hasn’t started",
      cell: "Waiting for the runner · it hasn’t started",
    },
    {
      t: 730,
      deployment: NONE,
      runner: "CREATING",
      line: "Stage awaits the runner · it’s being built",
      cell: "Waiting for the runner · it’s being built",
    },
    {
      t: 750,
      deployment: NONE,
      runner: "ACTIVE",
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      // The failure posted, and read on the deploy half's next minute.
      t: 790,
      deployment: NONE,
      runner: "ACTIVE",
      head: FAILED_ON_MAIN,
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    },
    {
      // Where the pass-34 bound held "on its way" for up to 15 minutes.
      t: 1000,
      deployment: NONE,
      runner: "ACTIVE",
      head: FAILED_ON_MAIN,
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    },
    {
      // The fix merged: main's new head has nothing on it yet (read at once for a merge pressed
      // here, on the deploy half's next minute for one pressed elsewhere).
      t: 1025,
      deployment: NONE,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      head: head(FIX, {
        context: "Zerops deploy / deploy (push)",
        state: "pending",
        created_at: iso(1011),
      }),
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 1033.9,
      deployment: BUILD.building,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: "Stage coming up · building the app",
      cell: "Deploying… 5d0e7a1",
    },
    {
      // N3: the build's process left; its version not active yet.
      t: 1096.1,
      services: [app("UPGRADING")],
      deployment: BUILD.ended,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: "Stage coming up · building the app",
      cell: "Deploying… 5d0e7a1",
    },
    {
      // N3: read again, its new version active and stated by nothing yet.
      t: 1096.4,
      deployment: BUILD.unstated,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: "Stage coming up · building the app",
      cell: "Deploying… 5d0e7a1",
    },
    {
      t: 1097.6,
      deployment: BUILD.running,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: "Stage coming up · turning its address on",
      cell: "Deployed 5d0e7a1",
    },
    {
      t: 1100.7,
      deployment: BUILD.running,
      routes: 1,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
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

describe("a push job that failed before the stage was added (H1)", () => {
  // The runner already up: main's push job failed at +660 s, before Add stage at +670.4 s. The
  // broker's dispatch of the same workflow on the same commit fails too, and posts nothing.
  const before = head(FIRST, {
    context: "Zerops deploy / deploy (push)",
    state: "failure",
    created_at: iso(660),
  });

  it("says it failed once the stage's import is done, and set up until then", () => {
    expect(
      said({
        t: 700.8,
        services: [app("CREATING")],
        deployment: NONE,
        runner: "ACTIVE",
        head: before,
      }),
    ).toMatchObject({ line: "Stage coming up · adding the app", cell: "Setting up a stage…" });
    expect(said({ t: 712.6, deployment: NONE, runner: "ACTIVE", head: before })).toMatchObject({
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    });
  });

  it("says nothing failed while the broker retries a refusal (H2)", () => {
    const refused = head(FIRST, {
      context: "mate/deploy/abacus-stage/app",
      state: "failure",
      description: "has no workflow zerops.yml for the stage",
      created_at: iso(700),
    });
    expect(said({ t: 712.6, deployment: NONE, runner: "ACTIVE", head: refused })).toMatchObject({
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    });
  });
});
