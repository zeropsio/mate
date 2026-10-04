/**
 * A stage coming up, replayed on run 4's clock (2 Oct 2026) with HQ deploying it, under invented
 * names: the menu's heading line (`listedStopComing` → `headingLine`, what the left menu reads) and
 * the projects page's stage cell (`groupFlow` → `stopLine`), step by step, with what lands "up"
 * between them.
 *
 * The run: the stage's project made at +1061 s; its declaration landed at +1092 s, when HQ queued
 * its deploy of `main` (code landed on `main` at +1032 s); HQ refused that job at +1268 s for want
 * of a deploy key, and the key kept at +1389 s asked for another; the stage's first build ran
 * +1407 → +1479 s and its address turned on at +1481 s.
 */
import {
  environmentRow,
  groupFlow,
  listedStopComing,
  stopServes,
  type FlowPullRequest,
  type GroupFlowInput,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import { zeropsDidNotAnswer } from "@t3tools/shared/hqDeploys";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { deployedVersion } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import { stopLine } from "./projects/projectsView.logic";
import { headingLanding, headingLine, type HeadingLineInput } from "./SidebarHeadingLine.logic";

const START = Date.parse("2026-10-02T09:00:00.000Z");
const at = (seconds: number) => START + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

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
  url: undefined,
  mergeability: "mergeable",
  behind: false,
  merged: true,
  mergedAt: iso(1032),
  headSha: "abc1234",
  baseBranch: "main",
  line: "appdev #1",
  updatedAt: iso(1032),
};

const app = (status: string) => ({ hostname: "app", status, runtime: true });
const db = (status: string) => ({ hostname: "db", status, runtime: false });

/** HQ's newest job of the stage's app, asked for at +`t` s. */
interface HqRecord {
  readonly id: string;
  readonly state: HqJob["state"];
  readonly reason?: string;
  /** When it ended, at +s. */
  readonly ended?: number;
  readonly t: number;
}

const QUEUED: HqRecord = { id: "1", state: "queued", t: 1092 };
const REFUSED: HqRecord = {
  id: "1",
  state: "refused",
  reason: "Brine - stage has no deploy token yet",
  ended: 1268,
  t: 1092,
};
const QUEUED_AGAIN: HqRecord = { id: "2", state: "queued", t: 1389 };
const HQ_DEPLOYING: HqRecord = { id: "2", state: "building", t: 1389 };
const LIVE: HqRecord = { id: "2", state: "live", ended: 1481, t: 1389 };

interface Moment {
  readonly t: number;
  readonly projectStatus?: string;
  readonly services?: ReadonlyArray<ReturnType<typeof app>> | undefined;
  readonly deployment: Shown<Deployment> | undefined;
  readonly routes?: number;
  /** HQ's record of its deploy; `undefined` for none. */
  readonly hq: HqRecord | undefined;
  readonly declared: boolean;
  /** HQ holds no deploy key that works for the stage. */
  readonly keyless?: boolean;
}

function record({ id, state, reason, ended, t }: HqRecord): HqJob {
  return {
    id,
    kind: "deploy",
    service: "app",
    sha: SHA,
    state,
    cause: id === "1" ? "env_added" : "key_kept",
    ref: null,
    reason: reason ?? null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: iso(t),
    endedAt: ended === undefined ? null : iso(ended),
    supersededBy: null,
  };
}

/** What the menu's line and the page's cell say at one moment. */
function said(moment: Moment) {
  const nowMs = at(moment.t);
  const latest = moment.hq === undefined ? undefined : record(moment.hq);
  const input: GroupFlowInput = {
    groupId: "g-brine",
    mates: [],
    pullRequests: [],
    merged: [merged],
    stops: [
      {
        projectId: STAGE_ID,
        name: "Brine - stage",
        createdAt: iso(1061),
        projectStatus: moment.projectStatus ?? "ACTIVE",
        services: moment.services ?? [app("ACTIVE")],
        tier: "stage",
        row: moment.declared
          ? environmentRow({
              projectId: STAGE_ID,
              name: "Brine - stage",
              tier: "stage",
              sources: ["main"],
              services: [
                latest === undefined
                  ? { hostname: "app" }
                  : { hostname: "app", deploy: { latest, live: null } },
              ],
              keyHeld: moment.keyless !== true,
            })
          : undefined,
        deployment: moment.deployment,
        route: undefined,
      },
    ],
    missing: [],
    release: {
      gate: { allowed: false, reason: "Nothing is merged to release." },
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
    waitingAtLeast: false,
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

const MAKING = { projectStatus: "CREATING", services: undefined };

describe("a stage coming up, replayed on run 4's clock with HQ deploying it", () => {
  const moments: ReadonlyArray<Moment & { readonly line: string | null; readonly cell: string }> = [
    {
      t: 1062,
      ...MAKING,
      deployment: undefined,
      hq: undefined,
      declared: false,
      line: "Stage coming up · making the project",
      cell: "Setting up a stage…",
    },
    {
      t: 1090,
      services: [db("CREATING"), app("NEW")],
      deployment: NONE,
      hq: undefined,
      declared: false,
      line: "Stage coming up · adding the database",
      cell: "Setting up a stage…",
    },
    {
      t: 1103,
      services: [db("ACTIVE"), app("CREATING")],
      deployment: NONE,
      hq: QUEUED,
      declared: true,
      line: "Stage coming up · adding the app",
      cell: "Setting up a stage…",
    },
    {
      t: 1121,
      deployment: NONE_RECHECKED,
      hq: QUEUED,
      declared: true,
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 1270,
      deployment: NONE,
      hq: REFUSED,
      declared: true,
      keyless: true,
      // Held for a key: its own fact on both, never coming up (restores 630d8f1bb's idea).
      line: "Stage awaits a deploy key",
      cell: "Stage awaits a deploy key",
    },
    {
      t: 1389,
      deployment: NONE,
      hq: QUEUED_AGAIN,
      declared: true,
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    },
    {
      t: 1407,
      deployment: DEPLOYING,
      hq: HQ_DEPLOYING,
      declared: true,
      line: "Stage coming up · building the app",
      cell: "Deploying… 7c41d9e",
    },
    {
      t: 1446,
      services: [db("ACTIVE"), app("UPGRADING")],
      deployment: DEPLOYING,
      hq: HQ_DEPLOYING,
      declared: true,
      line: "Stage coming up · building the app",
      cell: "Deploying… 7c41d9e",
    },
    {
      t: 1480,
      deployment: RUNNING,
      hq: HQ_DEPLOYING,
      declared: true,
      line: "Stage coming up · turning its address on",
      cell: "Deployed 7c41d9e",
    },
    {
      t: 1482,
      deployment: RUNNING,
      routes: 1,
      hq: LIVE,
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
      expect(said({ t, deployment: FAILED_BUILD, hq: HQ_DEPLOYING, declared: true })).toMatchObject(
        { line: "Stage didn’t come up · its first deploy failed", cell: "First deploy failed" },
      );
    }
    expect(said({ t: 86_400, deployment: FAILED_BUILD, hq: undefined, declared: true }).cell).toBe(
      "First deploy failed",
    );
  });

  it("says so where HQ records its build failing, however long ago", () => {
    const failed: HqRecord = { id: "2", state: "failed", ended: 1479, t: 1389 };
    expect(said({ t: 1500, deployment: NONE, hq: failed, declared: true })).toMatchObject({
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    });
    expect(said({ t: 86_400, deployment: NONE, hq: failed, declared: true }).cell).toBe(
      "First deploy failed",
    );
  });
});

describe("a stage whose first deploy Zerops did not answer", () => {
  // Zerops did not answer HQ's submission: nothing is tried twice, so HQ refused it at once.
  const silent: HqRecord = {
    id: "1",
    state: "refused",
    reason: zeropsDidNotAnswer("connect ETIMEDOUT"),
    ended: 1290,
    t: 1092,
  };

  it("says its first deploy failed, for a person to run again", () => {
    expect(said({ t: 1300, deployment: NONE, hq: silent, declared: true })).toMatchObject({
      line: "Stage didn’t come up · its first deploy failed",
      cell: "First deploy failed",
    });
  });
});

describe("a stage whose first deploy HQ still follows", () => {
  // HQ queued it; no build of it was seen yet, and HQ has not ended its job.
  const waiting: Moment = { t: 1500, deployment: NONE, hq: QUEUED, declared: true };
  // The stage's own coming-up window ran out (+1061 s made, 15 min).
  const past: Moment = { ...waiting, t: 1061 + 15 * 60 };

  it("is on its way while HQ's job is, however long ago it was asked", () => {
    expect(said(waiting)).toMatchObject({
      line: "Stage coming up · first deploy on its way",
      cell: "First deploy on its way",
    });
    expect(said(past).cell).toBe("First deploy on its way");
  });

  it("says its first deploy failed once HQ stops following it", () => {
    const stopped: HqRecord = {
      ...QUEUED,
      state: "refused",
      reason:
        "HQ stopped following the build 75 min after it was submitted; Zerops still reports it running",
      ended: 1092 + 75 * 60,
    };
    expect(said({ ...past, hq: stopped }).cell).toBe("First deploy failed");
  });

  it("never lands up as its window runs out", () => {
    expect(headingLanding(said({ ...past, t: past.t - 1 }).heading, said(past).heading)).toBe(
      undefined,
    );
  });

  it("says the neutral wait, never on its way, where HQ does not declare it yet", () => {
    expect(said({ ...waiting, declared: false })).toMatchObject({
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
    hq: LIVE,
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
      hq: LIVE,
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
