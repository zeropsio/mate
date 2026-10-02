/**
 * A stage's first deploy, replayed as run 5 measured it (2–3 Oct 2026), under invented names: the
 * menu's heading line (`listedStopComing` → `headingLine`) and the projects page's stage cell
 * (`groupFlow` → `stopLine`), step by step. At every moment both name the same phase.
 *
 * The run: code landed on `main` at +642.3 s; the group's runner was imported at +651.5 s and
 * stood READY_TO_DEPLOY; the stage's project was made at +670.4 s and its import ran until
 * +710.5 s (the project ACTIVE by ~+700 s, the app NEW → CREATING at ~+700 s → ACTIVE at +710.5 s);
 * the runner was built +723.8 → +749.2 s; the first build ran +1033.8 → +1097.3 s and the address
 * turned on at +1097.3 s.
 */
import {
  environmentRow,
  groupFlow,
  groupRunner,
  listedStopComing,
  stopServes,
  deployedVersion,
  type FlowPullRequest,
  type GroupFlowInput,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { describe, expect, it } from "vite-plus/test";

import { stopLine } from "./projects/projectsView.logic";
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
const DEPLOYING = known({ kind: "deploying", version: deployedVersion(FIX), previous: null });
const RUNNING = known({ kind: "running", activatedAt: null, version: deployedVersion(FIX) });

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
    services: [{ hostname: "app", repository: "appdev" }],
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
  return {
    line: line === undefined ? null : [line.fact, line.rest].filter(Boolean).join(" · "),
    cell: [cell.word, cell.version].filter(Boolean).join(" "),
  };
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
      t: 1033.9,
      deployment: DEPLOYING,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: "Stage coming up · building the app",
      cell: "Deploying… 5d0e7a1",
    },
    {
      // The build's process left and its version was not known yet: the store keeps the deploy
      // in flight through its grace (`afterBuilds`), so this is what both surfaces are handed.
      t: 1096.4,
      services: [app("UPGRADING")],
      deployment: DEPLOYING,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: "Stage coming up · building the app",
      cell: "Deploying… 5d0e7a1",
    },
    {
      t: 1097.6,
      deployment: RUNNING,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: "Stage coming up · turning its address on",
      cell: "Deployed 5d0e7a1",
    },
    {
      t: 1100.7,
      deployment: RUNNING,
      routes: 1,
      merged: [pull(1, 642.3), pull(2, 1010.9)],
      runner: "ACTIVE",
      line: null,
      cell: "Deployed 5d0e7a1",
    },
  ];

  it.each(moments)("+$t s", ({ line, cell, ...moment }) => {
    expect(said(moment)).toEqual({ line, cell });
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
