import { HqEnvironmentId } from "@t3tools/contracts";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  applicationDeletionTarget,
  applicationHoldings,
  deleteApplication,
  deleteApplicationWords,
  groupWithoutMate,
  lastMateDeletionTarget,
  projectDeleteOffered,
  type DeleteApplicationTarget,
} from "./ZeropsDeleteApplicationDialog.logic";

const target = (over: Partial<DeleteApplicationTarget> = {}): DeleteApplicationTarget => ({
  appId: "app-1",
  name: "shop",
  stages: [],
  productions: [],
  ...over,
});

describe("deleteApplicationWords — what the Delete project dialog lists", () => {
  it.each([
    {
      title: "lists every repository by name, the open changes and the stage as going",
      target: target({ stages: [{ projectId: "P_STAGE", name: "shop-stage" }] }),
      holdings: { repos: ["appdev", "group", "probe"], openChanges: 2 },
      goes: [
        "Repositories appdev and probe, with their history",
        "Its setup files",
        "2 open changes",
        "Stage shop-stage, with everything in it",
      ],
      stays: ["Anything on GitHub"],
    },
    {
      title: "says production stays in Zerops and is the person's to delete",
      target: target({ productions: [{ name: "shop-prod" }] }),
      holdings: { repos: ["appdev"], openChanges: 1 },
      goes: ["Repository appdev, with its history", "1 open change"],
      stays: [
        "Production shop-prod. Delete it in Zerops if you no longer need it.",
        "Anything on GitHub",
      ],
    },
    {
      title: "says a Git production stays on Git, with nothing to delete in Zerops",
      target: target({ productions: [{ name: "main", branch: "main" }] }),
      holdings: { repos: ["appdev"], openChanges: 0 },
      goes: ["Repository appdev, with its history"],
      stays: ["Production on Git branch main. Nothing to delete in Zerops.", "Anything on GitHub"],
    },
    {
      title: "names no open change where none is open",
      target: target(),
      holdings: { repos: ["group"], openChanges: 0 },
      goes: ["Its setup files"],
      stays: ["Anything on GitHub"],
    },
  ])("$title", ({ target: input, holdings, goes, stays }) => {
    const words = deleteApplicationWords(input, holdings);
    expect(words.goes).toEqual(goes);
    expect(words.stays).toEqual(stays);
    expect([words.title, words.label, words.submit]).toEqual([
      "Delete shop?",
      "Type shop to confirm",
      "Delete shop",
    ]);
  });

  it("lists nothing as going until HQ said what the project holds", () => {
    expect(deleteApplicationWords(target(), undefined).goes).toBeUndefined();
  });
});

describe("applicationDeletionTarget — what deleting a project takes, from its group", () => {
  it("deletes its stages' projects, keeps its productions', and has no project to delete for a branch", () => {
    expect(
      applicationDeletionTarget({
        groupId: "app-1",
        name: "shop",
        environments: [
          { role: "stage", project: { id: "P_STAGE", name: "shop-stage" } },
          { role: "prod", project: { id: "P_PROD", name: "shop-prod" } },
          { role: "stage", project: undefined },
        ],
      }),
    ).toEqual({
      appId: "app-1",
      name: "shop",
      stages: [{ projectId: "P_STAGE", name: "shop-stage" }],
      productions: [{ name: "shop-prod" }],
    });
  });

  it("lists a production on a Git branch, which has no Zerops project, as staying", () => {
    expect(
      applicationDeletionTarget({
        groupId: "app-1",
        name: "shop",
        environments: [
          { role: "stage", project: { id: "P_STAGE", name: "shop-stage" } },
          { role: "prod", project: undefined, branch: "main" },
          { role: "prod", project: undefined },
        ],
      }),
    ).toEqual({
      appId: "app-1",
      name: "shop",
      stages: [{ projectId: "P_STAGE", name: "shop-stage" }],
      productions: [{ name: "main", branch: "main" }],
    });
  });
});

describe("lastMateDeletionTarget — what deleting a project with its last Mate takes", () => {
  const placed = (id: string, name: string, kind: "mate" | "stage"): ZeropsProject => ({
    id,
    name,
    status: "ACTIVE",
    tagList: [],
    hq: { appId: "app-1", appName: "shop", kind, mate: null },
  });

  it("Deleting a project's last Mate lists a Git production as staying, as the other two delete dialogs do", () => {
    expect(
      lastMateDeletionTarget(
        [placed("P_MATE", "Fen", "mate"), placed("P_STAGE", "shop-stage", "stage")],
        {
          id: "app-1",
          name: "shop",
          environments: [
            {
              id: HqEnvironmentId.make("git-production"),
              target: { kind: "git", branch: "main", delivery: "direct" },
              tier: "production",
              name: "Production",
              sources: ["release"],
              order: 1,
              keyHeld: false,
              keyInvalid: false,
              can: {},
              birth: null,
              release: null,
              jobs: [],
            },
          ],
        },
      ),
    ).toEqual({
      appId: "app-1",
      name: "shop",
      stages: [{ projectId: "P_STAGE", name: "shop-stage" }],
      productions: [{ name: "main", branch: "main" }],
    });
  });
});

describe("a project without a Mate is offered Delete, on the menu and the projects page alike", () => {
  it.each([
    { name: "no Mate, to a writer: offered", withoutMate: true, mayDelete: true, offered: true },
    { name: "no Mate, to anyone else: not", withoutMate: true, mayDelete: false, offered: false },
    { name: "holding a Mate: not", withoutMate: false, mayDelete: true, offered: false },
  ])("$name", ({ withoutMate, mayDelete, offered }) => {
    expect(projectDeleteOffered({ withoutMate, mayDelete })).toBe(offered);
  });

  it.each([
    { name: "nothing in it", environments: [], pending: [], without: true },
    {
      name: "a stage and a production alone",
      environments: [{ role: "stage" }, { role: "prod" }],
      pending: [],
      without: true,
    },
    { name: "a Mate listed", environments: [{ role: "dev" }], pending: [], without: false },
    {
      name: "a dev and stage place listed",
      environments: [{ role: "devstage" }],
      pending: [],
      without: false,
    },
    { name: "a Mate coming", environments: [], pending: [{ kind: "mate" }], without: false },
    {
      name: "only a stage coming",
      environments: [],
      pending: [{ kind: "stage" }],
      without: true,
    },
  ])("a group with $name has no Mate: $without", ({ environments, pending, without }) => {
    expect(groupWithoutMate({ environments, pending })).toBe(without);
  });
});

describe("applicationHoldings — what HQ holds of the project, from its detail", () => {
  it.each([
    {
      title: "counts only open changes and names every repository",
      detail: {
        repos: [{ name: "appdev" }, { name: "group" }],
        changes: [{ state: "open" }, { state: "merged" }, { state: "open" }, { state: "closed" }],
      },
      holdings: { repos: ["appdev", "group"], openChanges: 2 },
    },
    {
      title: "is unknown while its changes are unread",
      detail: { repos: [{ name: "appdev" }], changes: undefined },
      holdings: undefined,
    },
    {
      title: "is unknown while its repositories are unread",
      detail: { repos: undefined, changes: [] },
      holdings: undefined,
    },
  ] as const)("$title", ({ detail, holdings }) => {
    expect(applicationHoldings(detail)).toEqual(holdings);
  });
});

describe("deleteApplication — the stage goes from Zerops before HQ deletes the project", () => {
  it.each([
    {
      title: "deletes each stage, then the project in HQ",
      stages: [
        { projectId: "P_S1", name: "shop-stage" },
        { projectId: "P_S2", name: "shop-qa" },
      ],
      failing: undefined,
      steps: ["zerops P_S1", "zerops P_S2", "hq app-1"],
      error: undefined,
    },
    {
      title: "stops before anything in HQ goes when a stage's deletion fails, and says why",
      stages: [{ projectId: "P_S1", name: "shop-stage" }],
      failing: "P_S1",
      steps: ["zerops P_S1"],
      error:
        "Stage shop-stage was not deleted, so HQ kept shop. You have no access to this project.",
    },
    {
      title: "deletes the project in HQ alone where it has no stage",
      stages: [],
      failing: undefined,
      steps: ["hq app-1"],
      error: undefined,
    },
  ])("$title", async ({ stages, failing, steps, error }) => {
    const seen: string[] = [];
    const run = deleteApplication(target({ stages }), {
      deleteProject: async (projectId) => {
        seen.push(`zerops ${projectId}`);
        if (projectId === failing) throw new Error("You have no access to this project.");
      },
      deleteInHq: async (appId) => {
        seen.push(`hq ${appId}`);
      },
    });
    if (error === undefined) await run;
    else await expect(run).rejects.toThrow(error);
    expect(seen).toEqual(steps);
  });
});
