import { hqOperationOf } from "@t3tools/client-runtime/data";
import type { HqOperation, HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { expect, it } from "vite-plus/test";

import {
  deletionOffer,
  deletionProjectOf,
  deletionParts,
  deletionStart,
  sameDeletionStart,
  projectDeletionPlan,
  projectDeletionReady,
  projectDeletionWords,
  type DeletionEnvironment,
  type DeletionProject,
} from "./deletion.logic.ts";

const AT = "2026-11-25T10:00:00.000Z";
const MATE = { projectId: "Z_RYE", name: "Rye" };
const stage = (projectId: string, deletable = true): DeletionEnvironment => ({
  tier: "stage",
  kind: "zerops",
  projectId,
  name: projectId.toLowerCase(),
  deletable,
  madeByMate: false,
});
const production = (projectId: string, more: Partial<DeletionEnvironment> = {}) =>
  ({
    tier: "production",
    kind: "zerops",
    projectId,
    name: projectId.toLowerCase(),
    deletable: true,
    madeByMate: true,
    ...more,
  }) as DeletionEnvironment;
const deletion = (operation?: Partial<HqOperation>) =>
  hqOperationOf(
    operation === undefined
      ? undefined
      : {
          id: "op-1",
          kind: "app_deletion",
          phase: "accepted",
          at: AT,
          acceptedAt: AT,
          ...operation,
        },
    "app_deletion",
  );
const bakery = (more: Partial<DeletionProject> = {}): DeletionProject => ({
  appId: "app-bakery",
  name: "bakery",
  placements: [
    { projectId: "Z_RYE", kind: "mate", name: "Rye" },
    { projectId: "Z_STAGE", kind: "stage", name: "z_stage" },
  ],
  births: [],
  deleteApp: true,
  environments: [stage("Z_STAGE")],
  hidden: [],
  deletion: deletion(),
  ...more,
});
const zeropsRefusal = {
  step: "delete_project",
  code: "insufficientPermissions",
  at: AT,
  origin: "zerops",
  zerops: { words: "Forbidden." },
} as const;

// witness: apps/web/src/components/zerops/deletion.logic.ts | if (others.length > 0 || births.length > 0) { → if (others.length > 0) {
it("MN83: A Mate's or a project's Delete offers exactly what the person may delete: a Mate that is not its project's last goes alone, the last Mate of a project the person may not delete whole goes alone keeping the project, the last Mate of one they may delete offers the choice, and a project HQ deletes, waits on or failed to delete shows that; breaks: the last Mate's Delete deletes a project holding a Mate still being set up or a Stage the person cannot delete", () => {
  const other = { projectId: "Z_OAT", kind: "mate", name: "Oat" };
  const plain = { projectId: "Z_PLAIN", kind: "plain", name: "z_plain" };
  const cases: ReadonlyArray<
    readonly [string, Parameters<typeof deletionOffer>[0], string, ReadonlyArray<string>?]
  > = [
    [
      "another Mate stands",
      { mate: MATE, project: bakery({ placements: [...bakery().placements, other] }) },
      "mate",
    ],
    [
      "a plain project stands",
      { mate: MATE, project: bakery({ placements: [...bakery().placements, plain] }) },
      "mate",
    ],
    ["a birth is on its way in", { mate: MATE, project: bakery({ births: [null] }) }, "mate"],
    ["in no project", { mate: MATE }, "mate"],
    [
      "last, not an Owner or Admin",
      { mate: MATE, project: bakery({ deleteApp: false }) },
      "last-mate-only",
    ],
    [
      "last, not the Stage's Admin",
      { mate: MATE, project: bakery({ environments: [stage("Z_STAGE", false)] }) },
      "last-mate-only",
    ],
    [
      "last, a hidden Stage",
      { mate: MATE, project: bakery({ hidden: ["stage"] }) },
      "last-mate-only",
    ],
    ["last, every Stage theirs", { mate: MATE, project: bakery() }, "last-choice", ["Z_STAGE"]],
    [
      "last, a hidden Production stays",
      { mate: MATE, project: bakery({ hidden: ["production"] }) },
      "last-choice",
      ["Z_STAGE"],
    ],
    [
      "its own Delete",
      { project: bakery({ placements: [bakery().placements[1]!] }) },
      "project",
      ["Z_STAGE"],
    ],
    ["HQ deletes it", { mate: MATE, project: bakery({ deletion: deletion({}) }) }, "standing"],
    [
      "it waits for another person",
      {
        project: bakery({
          deletion: deletion({
            failure: { ...zeropsRefusal, code: "token_expired", origin: "hq" },
            continueBy: "u-theo",
          }),
        }),
      },
      "standing",
    ],
    [
      "it ended failed",
      { project: bakery({ deletion: deletion({ failure: zeropsRefusal }) }) },
      "standing",
    ],
    [
      "the opened Mate was released",
      {
        mate: MATE,
        project: bakery({ placements: [], deletion: deletion({ failure: zeropsRefusal }) }),
        past: "op-1",
      },
      "project",
      ["Z_STAGE"],
    ],
    [
      "a different failure is shown",
      {
        mate: MATE,
        project: bakery({ deletion: deletion({ id: "op-2", failure: zeropsRefusal }) }),
        past: "op-1",
      },
      "standing",
    ],
    [
      "the Mate is an open birth",
      { mate: MATE, project: bakery({ placements: [], births: [MATE.projectId] }) },
      "last-choice",
      ["Z_STAGE"],
    ],
    [
      "Delete again over its failure",
      {
        project: bakery({ placements: [], deletion: deletion({ failure: zeropsRefusal }) }),
        past: "op-1",
      },
      "project",
      ["Z_STAGE"],
    ],
  ];
  for (const [state, facts, kind, stages] of cases) {
    const offer = deletionOffer(facts);
    const plan = offer.kind === "last-choice" || offer.kind === "project" ? offer.plan : undefined;
    expect({
      state,
      kind: offer.kind,
      stages: plan?.stages.map((entry) => entry.projectId),
    }).toEqual({
      state,
      kind,
      stages,
    });
  }
  expect(projectDeletionPlan(bakery({ placements: [plain] }), undefined).refusal).toBe(
    "A plain project still belongs to this project. Remove it first.",
  );
  expect(projectDeletionPlan(bakery({ placements: [], births: [null] }), undefined).refusal).toBe(
    "A Mate still works on this project. Delete it first.",
  );
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | environment.deletable && environment.madeByMate && environment.name !== undefined; → environment.deletable && environment.name !== undefined;
it("MN7: Deleting a project deletes its stages' Zerops projects and a production's only once the person slid it; a production not slid, one Mate did not make, one on a Git branch and one the person cannot see are listed as staying", () => {
  const plan = projectDeletionPlan(
    bakery({
      placements: [],
      environments: [
        stage("Z_STAGE"),
        production("Z_LIVE"),
        production("Z_ATTACHED", { madeByMate: false }),
        { tier: "production", kind: "git", branch: "release" },
      ],
      hidden: ["production"],
    }),
    undefined,
  );
  expect(plan.stages.map((entry) => entry.projectId)).toEqual(["Z_STAGE"]);
  expect(plan.productions.map((entry) => entry.projectId)).toEqual(["Z_LIVE"]);
  const words = (slid: ReadonlyArray<string>) =>
    projectDeletionWords({
      name: "bakery",
      plan,
      holdings: { repos: [], openChanges: 0 },
      slid: new Set(slid),
    });
  expect(words(["Z_STAGE", "Z_LIVE"]).goes).toEqual([
    "Stage z_stage goes from Zerops, with everything in it",
    "Production z_live goes from Zerops, with its services and data",
  ]);
  expect(words(["Z_STAGE"]).goes).toEqual([
    "Stage z_stage goes from Zerops, with everything in it",
  ]);
  expect(words(["Z_STAGE"]).stays).toEqual([
    "Production z_live stays in Zerops and keeps running. Mate lets go of it.",
    "Production z_attached stays in Zerops and keeps running. Mate lets go of it.",
    "Production on Git branch release. Nothing to delete in Zerops.",
    "A Production you have no access to stays in Zerops.",
    "Anything on GitHub",
  ]);
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | return slid && deleteMateConfirmed(typed, name); → return slid;
it("MN84: The whole project's Delete sends one project deletion naming its last Mate, every Stage and only the Productions slid, and no Mate deletion; the last Mate's Delete alone sends one Mate deletion that keeps its project's code; breaks: a Production not slid is deleted, or the Mate and the project are deleted by two starts", () => {
  const plan = projectDeletionPlan(
    bakery({ environments: [stage("Z_STAGE"), production("Z_LIVE"), production("Z_SHOP")] }),
    MATE,
  );
  const mate = { kind: "mate", projectId: MATE.projectId, stays: undefined } as const;
  const only = { kind: "last-mate-only", projectId: MATE.projectId, stays: "" } as const;
  const choice = { kind: "last-choice", projectId: MATE.projectId, appId: "app", plan } as const;
  const project = { kind: "project", appId: "app", plan } as const;
  const standing = { kind: "standing", deletion: { kind: "going", id: "other" } } as const;
  const confirmed = {
    kind: "project",
    slid: new Set(["Z_STAGE", "Z_SHOP", "Z_LIVE"]),
    productionTyped: { Z_SHOP: "z_shop", Z_LIVE: "old-name" },
  } as const;
  const mateChoice = { kind: "mate" } as const;
  const base = { orgId: "org", id: "op" };
  const mateStart = {
    kind: "start-mate-deletion",
    orgId: "org",
    id: "op",
    projectId: MATE.projectId,
  } as const;
  const appStart = {
    kind: "start-app-deletion",
    orgId: "org",
    id: "op",
    appId: "app",
    stages: ["Z_STAGE"],
    productions: ["Z_SHOP"],
  } as const;
  for (const [offer, selected, expected] of [
    [mate, mateChoice, mateStart],
    [mate, confirmed, mateStart],
    [only, mateChoice, { ...mateStart, keptGit: "keep" }],
    [only, confirmed, { ...mateStart, keptGit: "keep" }],
    [choice, mateChoice, { ...mateStart, keptGit: "keep" }],
    [choice, confirmed, { ...appStart, mate: MATE.projectId }],
    [project, mateChoice, undefined],
    [project, confirmed, appStart],
    [standing, mateChoice, undefined],
    [standing, confirmed, undefined],
  ] as const) {
    expect(deletionStart({ ...base, offer, choice: selected })).toEqual(expected);
  }
  const ready = projectDeletionReady(plan, confirmed, true);
  expect([...ready.slid]).toEqual(["Z_STAGE", "Z_SHOP"]);
  const first = deletionStart({ ...base, offer: project, choice: confirmed })!;
  const next = deletionStart({
    ...base,
    offer: project,
    choice: { ...confirmed, slid: new Set(["Z_STAGE"]) },
  })!;
  expect(sameDeletionStart(first, { ...first, id: "another" })).toBe(true);
  expect(sameDeletionStart(first, next)).toBe(false);
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | if (plan.stages.some((stage) => !slid.has(stage.projectId))) → if (plan.stages.every((stage) => !slid.has(stage.projectId)))
it("MN85: A project's Delete opens only once every Stage is slid and its name is typed, and a Production not slid never holds it; breaks: Delete opens with a Stage not slid", () => {
  const plan = projectDeletionPlan(
    bakery({ environments: [stage("Z_STAGE"), stage("Z_REVIEW"), production("Z_LIVE")] }),
    MATE,
  );
  const ready = (slid: ReadonlyArray<string>, typed: boolean) =>
    projectDeletionReady(plan, { slid: new Set(slid), productionTyped: {} }, typed).ready;
  expect(ready([], true)).toBe(false);
  expect(ready(["Z_STAGE"], true)).toBe(false);
  expect(ready(["Z_STAGE", "Z_REVIEW"], false)).toBe(false);
  expect(ready(["Z_STAGE", "Z_REVIEW"], true)).toBe(true);
  expect(ready(["Z_STAGE", "Z_REVIEW", "Z_LIVE"], true)).toBe(true);
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | project.deletion.kind === "failed" && step.state !== "gone" → project.deletion.kind === "waiting" && step.state !== "gone"
it("MN86: A project's deletion lists a part as deleting only while it runs: waiting, the part it stopped at reads stopped there; ended failed, every part not gone reads still here, the one it stopped at included; breaks: a stopped deletion still reads as deleting its Stage", () => {
  const steps = [
    { part: "mate", projectId: "Z_RYE", state: "gone" },
    { part: "stage", projectId: "Z_STAGE", state: "deleting" },
    { part: "code", state: "pending" },
  ];
  const states = (operation: Partial<HqOperation>) =>
    deletionParts(bakery({ deletion: deletion(operation), steps })).map((part) => part.state);
  expect(states({})).toEqual(["gone", "deleting", "pending"]);
  expect(
    states({
      failure: { ...zeropsRefusal, code: "token_expired", origin: "hq" },
      continueBy: "u-theo",
    }),
  ).toEqual(["gone", "stopped", "pending"]);
  expect(states({ failure: zeropsRefusal })).toEqual(["gone", "here", "here"]);
  const named = deletionParts(
    bakery({
      steps: [
        { part: "mate", projectId: "gone", name: "member", state: "gone" },
        { part: "stage", projectId: "missing", name: "stage-name", state: "gone" },
        { part: "production", projectId: "missing", name: "production-name", state: "deleting" },
        { part: "stage", projectId: "Z_STAGE", state: "pending" },
      ],
    }),
  );
  expect(named.map((part) => part.label)).toEqual([
    "member",
    "Stage stage-name",
    "Production production-name",
    "A Stage",
  ]);
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | madeByMate: environment.deleteProjectOnRemoval === true, → madeByMate: false,
it("MN87: What HQ's structure says of a project becomes the deletion's facts one to one: a Stage or Production the person may delete as deletable, a Production a Mate made as made by a Mate, the right to delete the project, hidden tiers, and a project nobody names without a name; breaks: an attached Production is offered for deletion and HQ refuses it, or a Production is unlocked by typing a placeholder.", () => {
  const can = { delete_project: { allow: true } };
  const structure = {
    can: { delete_app: { allow: true } },
    apps: [
      {
        id: "app",
        name: "project",
        projects: [
          { projectId: "stage", kind: "stage", name: "stage-name" },
          { projectId: "made", kind: "production", name: "production-name" },
          { projectId: "attached", kind: "production" },
        ],
        environments: [
          { tier: "stage", target: { kind: "zerops", projectId: "stage" }, can },
          {
            tier: "production",
            target: { kind: "zerops", projectId: "made" },
            can,
            deleteProjectOnRemoval: true,
          },
          {
            tier: "production",
            target: { kind: "zerops", projectId: "attached" },
            can,
            deleteProjectOnRemoval: false,
          },
        ],
        hiddenEnvironments: [{ tier: "production" }],
      },
    ],
  } as unknown as Pick<HqStructure, "can" | "apps">;
  const project = deletionProjectOf(structure, "app", { kind: "none" })!;
  expect(project.deleteApp).toBe(true);
  expect(project.hidden).toEqual(["production"]);
  expect(project.environments).toEqual([
    {
      tier: "stage",
      kind: "zerops",
      projectId: "stage",
      name: "stage-name",
      deletable: true,
      madeByMate: false,
    },
    {
      tier: "production",
      kind: "zerops",
      projectId: "made",
      name: "production-name",
      deletable: true,
      madeByMate: true,
    },
    {
      tier: "production",
      kind: "zerops",
      projectId: "attached",
      name: undefined,
      deletable: true,
      madeByMate: false,
    },
  ]);
  expect(project.placements[2]?.name).toBeUndefined();
  expect(projectDeletionPlan(project, undefined).productions).toEqual([
    { projectId: "made", name: "production-name" },
  ]);
  expect(
    deletionProjectOf(
      { ...structure, can: { delete_app: { allow: false, reason: "denied" } } },
      "app",
      { kind: "none" },
    )?.deleteApp,
  ).toBe(false);
});
