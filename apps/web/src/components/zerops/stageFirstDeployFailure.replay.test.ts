/**
 * A stage's first deploy failing on `main`'s head, replayed as run 6 measured it (3 Oct 2026),
 * under invented names: the deploy half's reads at the times the client made them
 * (`readGroupDeploys`, one a minute, through the shared status memo and the head's read ladder),
 * each answer's row, the flow, the menu's heading line and the projects page's cell — what the
 * provider and the menu compose, on the menu's minute clock.
 *
 * The run: code landed on `main` at +823.9 s and the workflow's push run queued on it at +820.8 s;
 * the stage's project was made at +845.0 s, and the broker dispatched its deploy at +854.8 s; the
 * group's runner was up by +942 s; the push run started at +937.8 s and failed at +951.8 s, before
 * it asked the broker for its grant. Nothing was posted after it. Every surface says the failure
 * from the first read that carries it (+973 s), and on every read after.
 */
import {
  environmentRow,
  type GiteaClient,
  type GiteaCommitStatus,
  groupFlow,
  groupRunner,
  listedStopComing,
  type FlowPullRequest,
  type GroupFlowInput,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import { createForgeReads } from "@t3tools/client-runtime/zerops/forge";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  readGroupDeploys,
  type ZeropsDeployGroup,
  type ZeropsGroupDeployState,
} from "../../zerops/useZeropsGroupDeploys";
import { stopLine } from "./projects/projectsView.logic";
import { headingLine } from "./SidebarHeadingLine.logic";

const START = Date.parse("2026-10-03T09:12:30.000Z");
const at = (seconds: number) => START + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

const STAGE_ID = "p-lantern-stage";
const MADE = 845.0;
const HEAD = "7c1e9a4b2d5f80316e9c4a7b1d2e5f8093a6c4b7";
const PUSH = "Zerops deploy / deploy (push)";
const BROKER = "mate/deploy/lantern-stage/app";

const status = (
  context: string,
  state: string,
  description: string,
  seconds: number,
): GiteaCommitStatus =>
  ({ context, state, description, created_at: iso(seconds) }) as GiteaCommitStatus;

/** What run 6's head carried, oldest first: the push run failed before it asked for its grant. */
const RUN_6: ReadonlyArray<GiteaCommitStatus> = [
  status(PUSH, "pending", "Waiting to run", 820.8),
  status(BROKER, "pending", "dispatched", 854.8),
  status(PUSH, "pending", "In progress", 937.8),
  status(PUSH, "failure", "Failing after 14s", 951.8),
];

const ENVIRONMENTS = `version: 1
environments:
  lantern-stage:
    tier: stage
    project: ${STAGE_ID}
    sources: [main]
    deploy: on-push
`;

const STAGE_TIER = `services:
  - hostname: app
    type: nodejs@24
    buildFromGit: https://gitea.test/lantern/appdev
`;

/** The group's Gitea as the run read it: each read answers what was posted by then, newest first. */
function lanternGitea(posted: ReadonlyArray<GiteaCommitStatus>) {
  return {
    listUserRepositories: async () => [],
    listOrganizationRepositories: async () => [
      { name: "group", default_branch: "main", updated_at: iso(857.9), open_pr_counter: 0 },
      { name: "appdev", default_branch: "main", updated_at: iso(823.9), open_pr_counter: 0 },
    ],
    listDirectory: async (_owner: string, repo: string) =>
      repo === "group" ? ["environments.yaml", "3 — Stage"] : [],
    readFile: async (_owner: string, repo: string, path: string) => {
      if (repo !== "group") return undefined;
      if (path === "environments.yaml") return { content: ENVIRONMENTS };
      if (path === "3 — Stage/import.yaml") return { content: STAGE_TIER };
      return undefined;
    },
    listPullRequests: async () => [],
    getBranch: async (_owner: string, repo: string) => ({
      name: "main",
      commit: { id: repo === "appdev" ? HEAD : "9b8a7c6d5e4f30211a2b3c4d5e6f708192a3b4c5" },
    }),
    listCommitStatuses: async () =>
      posted.filter((entry) => Date.parse(entry.created_at ?? "") <= Date.now()).toReversed(),
  } as unknown as GiteaClient;
}

const GROUP: ZeropsDeployGroup = {
  groupId: "g-lantern",
  slug: "lantern",
  projects: [
    {
      projectId: STAGE_ID,
      name: "Lantern - stage",
      role: "stage",
      createdAt: iso(MADE),
      services: [{ serviceId: "s-app", hostname: "app" }],
    },
  ],
};

/** The import's no-code version runs: nothing deployed. */
const NOTHING_RUNS: Shown<Deployment> = {
  state: "known",
  value: { kind: "none" },
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
};

const LANDED: FlowPullRequest = {
  repository: "appdev",
  number: 1,
  title: "Answer the health check",
  kind: "code",
  mateProjectId: "p-lantern-mate",
  author: "mate-p-lantern-mate",
  url: undefined,
  checks: "none",
  checkWord: undefined,
  mergeability: "mergeable",
  merged: true,
  mergedAt: iso(823.9),
  headSha: "c0ffee2",
  baseBranch: "main",
  line: "appdev #1",
  updatedAt: iso(823.9),
};

const APP = [{ hostname: "app", status: "ACTIVE", runtime: true }];

/** The menu's line and the page's cell from one deploy answer, on the minute clock at `nowMs`. */
function said(state: ZeropsGroupDeployState | undefined, nowMs: number) {
  const entry = state?.environments.find((environment) => environment.projectId === STAGE_ID);
  const input: GroupFlowInput = {
    groupId: GROUP.groupId,
    mates: [],
    pullRequests: [],
    merged: [LANDED],
    stops: [
      {
        projectId: STAGE_ID,
        name: "Lantern - stage",
        tier: "stage",
        row: entry === undefined ? undefined : environmentRow(entry),
        deployment: NOTHING_RUNS,
        route: undefined,
        createdAt: iso(MADE),
        projectStatus: "ACTIVE",
        services: APP,
      },
    ],
    missing: [],
    release: {
      gate: { allowed: false, reason: "Nothing to release." },
      suggestion: "",
      waiting: 0,
    },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable: false,
    pending: [],
    runner: groupRunner({
      slug: "lantern",
      services: [{ name: "runnerlantern", status: "ACTIVE" }],
    }),
    nowMs,
  };
  const stop = groupFlow(input).stages[0];
  if (stop === undefined) throw new Error("the stage is listed");
  const listed = {
    stop,
    projectStatus: "ACTIVE",
    createdAt: iso(MADE),
    services: APP,
    building: false,
    routes: 0,
  };
  const line = headingLine(
    {
      production: undefined,
      stages: [
        {
          projectId: STAGE_ID,
          name: "Lantern - stage",
          coming: listedStopComing("stage", listed, nowMs),
          serves: false,
        },
      ],
      waiting: 0,
      allOnStage: false,
    },
    undefined,
  );
  const cell = stopLine(stop);
  return {
    line: line === undefined ? null : [line.fact, line.rest].filter(Boolean).join(" · "),
    cell: [cell.word, cell.version].filter(Boolean).join(" "),
  };
}

/** The client's group reads in run 6, by seconds from its start. */
const READS = [876, 886, 912, 973, 1032, 1092, 1152, 1212, 1272, 1332, 1392];

/** Each read's words, the deploy half reading as the hook does and the menu on its minute. */
async function replay(posted: ReadonlyArray<GiteaCommitStatus>) {
  const client = lanternGitea(posted);
  const reads = createForgeReads();
  let held: ZeropsGroupDeployState | undefined;
  const said_: Array<{ readonly t: number; readonly line: string | null; readonly cell: string }> =
    [];
  for (const t of READS) {
    vi.setSystemTime(at(t));
    held = (
      await readGroupDeploys({
        client,
        group: GROUP,
        scope: "group",
        readVersion: async () => undefined,
        held,
        signal: new AbortController().signal,
        reads,
      })
    )(held);
    said_.push({ t, ...said(held, Math.floor(at(t) / 60_000) * 60_000) });
  }
  return said_;
}

const ON_ITS_WAY = {
  line: "Stage coming up · first deploy on its way",
  cell: "First deploy on its way",
};
const FAILED = {
  line: "Stage didn’t come up · its first deploy failed",
  cell: "First deploy failed",
};

describe("a stage's first deploy failing on main's head, replayed as run 6 measured it", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      case: "the push run fails and nothing is posted after it (run 6)",
      posted: RUN_6,
      // From the first read that carries the failure, and on every read after.
      from: (t: number) => (t < 973 ? ON_ITS_WAY : FAILED),
    },
    {
      case: "the broker's dispatch gets past its steps later: its grant turns it",
      posted: [...RUN_6, status(BROKER, "pending", "deploying 7c1e9a4", 1100)],
      from: (t: number) => (t < 973 || t >= 1152 ? ON_ITS_WAY : FAILED),
    },
    {
      case: "the broker reports its own job failed: final, and why",
      posted: [...RUN_6, status(BROKER, "failure", "failed: the test step exited with 1", 1100)],
      from: (t: number) => (t < 973 ? ON_ITS_WAY : FAILED),
    },
  ])("$case", async ({ posted, from }) => {
    vi.useFakeTimers();
    vi.setSystemTime(at(READS[0] ?? 0));
    const words = await replay(posted);
    expect(words).toEqual(READS.map((t) => ({ t, ...from(t) })));
  });
});
