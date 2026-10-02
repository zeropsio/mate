/**
 * A stage coming up, replayed as run 4 measured it (2 Oct 2026), under invented names: the menu's
 * heading line (`listedStopComing` → `headingLine`, what the left menu reads) and the projects
 * page's stage cell (`groupFlow` → `stopLine`), step by step, with what lands "up" between them.
 *
 * The run: the stage's project made at +1061 s; its declaration landed at +1092 s, when the
 * broker asked for its deploy of `main` (code landed on `main` at +1032 s); the group's runner,
 * imported at +1020 s, failed its build at +1087 s and stood READY_TO_DEPLOY until it was
 * deleted and imported again at +1268 s, active at +1389 s; the stage's first build ran
 * +1407 → +1479 s and its address turned on at +1481 s.
 */
import {
  environmentRow,
  groupFlow,
  groupRunner,
  listedStopComing,
  stopServes,
  type FlowPullRequest,
  type GroupFlowInput,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { deployedVersion } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { stopLine } from "./projects/projectsView.logic";
import { headingLanding, headingLine, type HeadingLineInput } from "./SidebarHeadingLine.logic";

const START = Date.parse("2026-10-02T09:00:00.000Z");
const at = (seconds: number) => START + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

const SLUG = "brine";
const STAGE_ID = "p-brine-stage";
const SHA = "7c41d9e0a2b35f6e8d1c0b9a4f3e2d1c0b9a8f7e";

const known = (value: Deployment): Shown<Deployment> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});
const NONE = known({ kind: "none" });
/**
 * +1121 s: the import's no-code version activates, named by its id only (A14); the store keeps its
 * "nothing deployed" while the version is stated (F5), revalidating.
 */
const NONE_RECHECKED: Shown<Deployment> = {
  ...NONE,
  ...(NONE.state === "known" ? { freshness: { kind: "revalidating", sinceMs: 0 } } : {}),
} as Shown<Deployment>;
/** A build was seen to end and nothing it built runs (`afterBuild`). */
const FAILED_BUILD = known({ kind: "none", afterBuild: true });
const DEPLOYING = known({ kind: "deploying", version: deployedVersion(SHA), previous: null });
const RUNNING = known({ kind: "running", activatedAt: null, version: deployedVersion(SHA) });

const merged: FlowPullRequest = {
  repository: "appdev",
  number: 1,
  title: "Track the jars",
  kind: "code",
  mateProjectId: "p-brine-mate",
  author: "mate-p-brine-mate",
  url: undefined,
  checks: "none",
  checkWord: undefined,
  mergeability: "mergeable",
  merged: true,
  mergedAt: iso(1032),
  headSha: "abc1234",
  baseBranch: "main",
  line: "appdev #1",
  updatedAt: iso(1032),
};

const app = (status: string) => ({ hostname: "app", status, runtime: true });
const db = (status: string) => ({ hostname: "db", status, runtime: false });

interface Moment {
  readonly t: number;
  readonly projectStatus?: string;
  readonly services?: ReadonlyArray<ReturnType<typeof app>> | undefined;
  readonly deployment: Shown<Deployment> | undefined;
  readonly routes?: number;
  /** The runner's status; `undefined` for none in the Gitea project, `"unread"` for unread. */
  readonly runner: string | undefined;
  readonly declared: boolean;
}

/** What the menu's line and the page's cell say at one moment. */
function said(moment: Moment) {
  const nowMs = at(moment.t);
  const services =
    moment.runner === "unread"
      ? undefined
      : [
          { name: "web", status: "ACTIVE" },
          ...(moment.runner === undefined ? [] : [{ name: "runnerbrine", status: moment.runner }]),
        ];
  const input: GroupFlowInput = {
    groupId: "g-brine",
    mates: [],
    pullRequests: [],
    merged: [merged],
    stops: [
      {
        projectId: STAGE_ID,
        name: "Brine - stage",
        tier: "stage",
        row: moment.declared
          ? environmentRow({
              projectId: STAGE_ID,
              name: "Brine - stage",
              tier: "stage",
              sources: ["main"],
              services: [{ hostname: "app" }],
              environment: "brine-stage",
            })
          : undefined,
        deployment: moment.deployment,
        route: undefined,
        createdAt: iso(1061),
        projectStatus: moment.projectStatus ?? "ACTIVE",
        services: moment.services ?? [db("ACTIVE"), app("ACTIVE")],
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
    runner: groupRunner({ slug: SLUG, services }),
    nowMs,
  };
  const stop = groupFlow(input).stages[0];
  if (stop === undefined) throw new Error("the stage is listed");
  const listed = {
    stop,
    projectStatus: moment.projectStatus ?? "ACTIVE",
    createdAt: iso(1061),
    services: moment.services ?? [db("ACTIVE"), app("ACTIVE")],
    building: moment.deployment?.state === "known" && moment.deployment.value.kind === "deploying",
    routes: moment.routes ?? 0,
  };
  const heading: HeadingLineInput = {
    production: undefined,
    stages: [
      {
        projectId: STAGE_ID,
        name: "Brine - stage",
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
    heading,
    line: line === undefined ? null : [line.fact, line.rest].filter(Boolean).join(" · "),
    cell: [cell.word, cell.version].filter(Boolean).join(" "),
  };
}

const READY = "READY_TO_DEPLOY";
/** A project not active yet is listed with none of its services (`candidateListingAtom`). */
const MAKING = { projectStatus: "CREATING", services: [] };

describe("a stage coming up, replayed as run 4 measured it", () => {
  const moments: ReadonlyArray<Moment & { readonly line: string | null; readonly cell: string }> = [
    {
      t: 1062,
      ...MAKING,
      deployment: undefined,
      runner: READY,
      declared: false,
      line: "Stage coming up · making the project",
      cell: "Setting up a stage…",
    },
    {
      t: 1090,
      services: [db("CREATING"), app("NEW")],
      deployment: NONE,
      runner: READY,
      declared: false,
      line: "Stage coming up · adding the database",
      cell: "Setting up a stage…",
    },
    {
      t: 1103,
      services: [db("ACTIVE"), app("CREATING")],
      deployment: NONE,
      runner: READY,
      declared: true,
      line: "Stage coming up · adding the app",
      cell: "Setting up a stage…",
    },
    {
      t: 1121,
      deployment: NONE_RECHECKED,
      runner: READY,
      declared: true,
      line: "Stage awaits the runner · it hasn’t started",
      cell: "Waiting for the runner · it hasn’t started",
    },
    {
      t: 1268,
      deployment: NONE,
      runner: undefined,
      declared: true,
      line: "Stage awaits the runner · it isn’t there",
      cell: "Waiting for the runner · it isn’t there",
    },
    {
      t: 1270,
      deployment: NONE,
      runner: READY,
      declared: true,
      line: "Stage awaits the runner · it hasn’t started",
      cell: "Waiting for the runner · it hasn’t started",
    },
    {
      t: 1370,
      deployment: NONE,
      runner: "CREATING",
      declared: true,
      line: "Stage awaits the runner · it’s being built",
      cell: "Waiting for the runner · it’s being built",
    },
    {
      t: 1389,
      deployment: NONE,
      runner: "ACTIVE",
      declared: true,
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 1407,
      deployment: DEPLOYING,
      runner: "ACTIVE",
      declared: true,
      line: "Stage coming up · building the app",
      cell: "Deploying… 7c41d9e",
    },
    {
      t: 1446,
      services: [db("ACTIVE"), app("UPGRADING")],
      deployment: DEPLOYING,
      runner: "ACTIVE",
      declared: true,
      line: "Stage coming up · building the app",
      cell: "Deploying… 7c41d9e",
    },
    {
      t: 1480,
      deployment: RUNNING,
      runner: "ACTIVE",
      declared: true,
      line: "Stage coming up · turning its address on",
      cell: "Deployed 7c41d9e",
    },
    {
      t: 1482,
      deployment: RUNNING,
      routes: 1,
      runner: "ACTIVE",
      declared: true,
      line: null,
      cell: "Deployed 7c41d9e",
    },
  ];

  it.each(moments)("+$t s", ({ line, cell, ...moment }) => {
    const now = said(moment);
    expect({ line: now.line, cell: now.cell }).toEqual({ line, cell });
  });

  it("never says the address before a deploy ran, nor Checking after an answer", () => {
    let answered = false;
    for (const { line: _line, cell: _cell, ...moment } of moments) {
      const now = said(moment);
      if (moment.deployment?.state !== "known" || moment.deployment.value.kind !== "running") {
        expect(now.line ?? "").not.toContain("turning its address on");
      }
      if (answered) expect(now.cell).not.toBe("Checking what runs here…");
      answered ||= moment.deployment?.state === "known";
    }
  });

  it("lands the stage up as its address turns on", () => {
    const [before, after] = [moments.at(-2), moments.at(-1)].map((moment) =>
      moment === undefined ? undefined : said(moment).heading,
    );
    expect(after === undefined ? undefined : headingLanding(before, after)).toEqual({
      kind: "up",
      name: "Stage",
    });
  });
});

describe("a stage whose first build failed", () => {
  // The build ended and the app keeps the import's no-code version: nothing it built runs.
  it("says so on the line and the cell, at once and after the window", () => {
    for (const t of [1500, 1061 + 15 * 60 - 1]) {
      expect(said({ t, deployment: FAILED_BUILD, runner: "ACTIVE", declared: true })).toMatchObject(
        { line: "Stage didn’t come up · its first deploy failed", cell: "First deploy failed" },
      );
    }
    expect(
      said({ t: 86_400, deployment: FAILED_BUILD, runner: "STOPPED", declared: true }).cell,
    ).toBe("First deploy failed");
  });
});

describe("a stage whose first deploy never starts", () => {
  // The broker asked; no build of it was ever seen.
  const waiting: Moment = { t: 1500, deployment: NONE, runner: "ACTIVE", declared: true };
  // 15 min after the later of the stage's making (+1061 s) and main's last code (+1032 s).
  const past: Moment = { ...waiting, t: 1061 + 15 * 60 };

  it("is on its way for a window, then says nothing is deployed, never on its way for ever", () => {
    expect(said(waiting)).toMatchObject({
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    });
    expect(said(past)).toMatchObject({ line: null, cell: "Nothing deployed yet" });
  });

  it("drops the runner's words with the window: a stopped runner past it has no job to wake for", () => {
    expect(said({ ...waiting, runner: "STOPPED" }).cell).toBe(
      "Waiting for the runner · it’s waking up",
    );
    for (const t of [past.t, 86_400]) {
      expect(said({ ...past, t, runner: "STOPPED" }).cell).toBe("Nothing deployed yet");
    }
  });

  it("never lands up as its window runs out", () => {
    expect(headingLanding(said({ ...past, t: past.t - 1 }).heading, said(past).heading)).toBe(
      undefined,
    );
  });

  it("says the neutral wait, never on its way, where the runner is not read", () => {
    expect(said({ ...waiting, runner: "unread" })).toMatchObject({
      line: "Stage coming up · awaiting a first deploy",
      cell: "Nothing deployed yet",
    });
  });
});

describe("a redeploy over the serving stage (its runtime UPGRADING)", () => {
  const serving: Moment = {
    t: 1490,
    deployment: RUNNING,
    routes: 1,
    runner: "ACTIVE",
    declared: true,
  };
  const redeploying: Moment = {
    ...serving,
    t: 1500,
    services: [db("ACTIVE"), app("UPGRADING")],
    deployment: known({
      kind: "deploying",
      version: deployedVersion(SHA),
      previous: { kind: "running", activatedAt: null, version: deployedVersion(SHA) },
    }),
  };
  it("is the deploy's to say, never the stage coming up, and lands nothing after", () => {
    expect(said(redeploying)).toMatchObject({ line: null, cell: "Deploying… 7c41d9e" });
    expect(headingLanding(said(redeploying).heading, said({ ...serving, t: 1560 }).heading)).toBe(
      undefined,
    );
  });
});

describe("a stage serving while what runs there is unread (a reload, a refused demand)", () => {
  it("says nothing of a first deploy, and lands nothing", () => {
    const reload: Moment = {
      t: 1490,
      deployment: undefined,
      routes: 1,
      runner: READY,
      declared: true,
    };
    expect(said(reload).line).toBeNull();
    expect(
      headingLanding(
        said({ ...reload, routes: 1 }).heading,
        said({ ...reload, deployment: RUNNING }).heading,
      ),
    ).toBe(undefined);
  });
});
