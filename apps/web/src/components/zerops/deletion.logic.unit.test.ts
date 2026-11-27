import { hqOperationOf, type AppEnvironmentsRead } from "@t3tools/client-runtime/data";
import type { HqOperation, HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { expect, it } from "vite-plus/test";

import { landingAfterProjectDelete } from "./ZeropsDeleteMateDialog.logic.ts";
import {
  chooseDeletionFate,
  deletionOffer,
  deletionPageMate,
  deletionPageState,
  deletionProjectOf,
  deletionParts,
  deletionStandingWords,
  deletionStart,
  partStateWords,
  sameDeletionStart,
  deletionReview,
  deletionChoiceAgain,
  everythingStays,
  type DeletionEnvironment,
  type DeletionProject,
  type DeletionChoice,
  type ApplicationHoldings,
} from "./deletion.logic.ts";

// witness: apps/web/src/components/zerops/ZeropsDeleteMateDialog.logic.ts | if (place === "git") return { to: "/git" as const, search: { appId } }; → if (place === "gone") return { to: "/git" as const, search: { appId } };
it("MN111: a finished deletion lands where what stays lives: kept code in Git, a project with a Zerops part on its page, or the projects when nothing stays; breaks: the person sees a fresh deletion form for what they kept.", () => {
  expect(landingAfterProjectDelete("git", "bakery")).toEqual({
    to: "/git",
    search: { appId: "bakery" },
  });
  expect(landingAfterProjectDelete("menu", "bakery")).toEqual({
    to: "/projects/$projectKey",
    params: { projectKey: "bakery" },
  });
  expect(landingAfterProjectDelete("gone", "bakery")).toEqual({ to: "/zerops" });
});

const AT = "2026-11-25T10:00:00.000Z";
const MATE = { projectId: "Z_RYE", name: "Rye" };
const NO_ENVIRONMENTS: AppEnvironmentsRead = { environments: undefined, unread: [] };
const stage = (
  projectId: string,
  deletable = true,
): Extract<DeletionEnvironment, { kind: "zerops" }> => ({
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
    { projectId: "Z_RYE", kind: "mate", name: "Rye", deletable: true },
    { projectId: "Z_STAGE", kind: "stage", name: "z_stage", deletable: true },
  ],
  births: [],
  deleteApp: true,
  environments: [stage("Z_STAGE")],
  environmentRecordsRead: true,
  environmentRecords: [],
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

const holdings: ApplicationHoldings = {
  repos: [
    { name: "docs", canKeep: true },
    { name: "web", canKeep: true },
    { name: "group", canKeep: false },
  ],
  openChanges: 2,
};
const choice = (
  fates: DeletionChoice["fates"] = {},
  slid: DeletionChoice["slid"] = {},
  projectName = "bakery",
  repoFates: DeletionChoice["repoFates"] = {},
): DeletionChoice => ({ fates, repoFates, slid, projectName });
const codeChoice = (repoFates: DeletionChoice["repoFates"]) => choice({}, {}, "bakery", repoFates);
const review = (
  project: DeletionProject,
  mate: typeof MATE | undefined,
  selected: DeletionChoice = choice(),
  held: ApplicationHoldings | undefined = holdings,
) => deletionReview({ project, mate, holdings: held, choice: selected });

// witness: apps/web/src/components/zerops/deletion.logic.ts | if (deletion.kind === "going" || deletion.kind === "waiting") → if (deletion.kind === "going" || deletion.kind === "waiting" || (deletion.kind === "failed" && deletion.id !== facts.past))
it("MN83: A Mate's or a project's Delete offers exactly what the person may delete: a Mate that is not its project's last goes alone, the last Mate of a project the person may not delete goes alone keeping the project, and the last Mate of one they may delete opens the project's page with it; a project HQ deletes or waits on shows that, and a failed project deletion leaves a Mate's Delete open while its project's Delete shows the failure; breaks: a Mate's Delete opens a failed project deletion instead of deleting the Mate", () => {
  const other = { projectId: "Z_OAT", kind: "mate", name: "Oat", deletable: true };
  const plain = { projectId: "Z_PLAIN", kind: "plain", name: "z_plain", deletable: true };
  const cases: ReadonlyArray<readonly [string, Parameters<typeof deletionOffer>[0], string]> = [
    [
      "another Mate",
      { mate: MATE, project: bakery({ placements: [...bakery().placements, other] }) },
      "mate",
    ],
    [
      "a plain project",
      { mate: MATE, project: bakery({ placements: [...bakery().placements, plain] }) },
      "project",
    ],
    ["a birth", { mate: MATE, project: bakery({ births: [null] }) }, "mate"],
    ["no project", { mate: MATE }, "mate"],
    [
      "not organization Admin",
      { mate: MATE, project: bakery({ deleteApp: false }) },
      "last-mate-only",
    ],
    [
      "not Stage Admin",
      { mate: MATE, project: bakery({ environments: [stage("Z_STAGE", false)] }) },
      "project",
    ],
    ["hidden Stage", { mate: MATE, project: bakery({ hidden: ["stage"] }) }, "project"],
    ["last Mate", { mate: MATE, project: bakery() }, "project"],
    ["project Delete", { project: bakery({ placements: [] }) }, "project"],
    ["running", { mate: MATE, project: bakery({ deletion: deletion({}) }) }, "standing"],
    [
      "running, another Mate",
      {
        mate: MATE,
        project: bakery({ placements: [...bakery().placements, other], deletion: deletion({}) }),
      },
      "standing",
    ],
    [
      "waiting",
      {
        project: bakery({
          deletion: deletion({
            failure: { ...zeropsRefusal, code: "token_expired", origin: "hq" },
            continueBy: "person",
          }),
        }),
      },
      "standing",
    ],
    [
      "waiting, last Mate without project Delete",
      {
        mate: MATE,
        project: bakery({
          deleteApp: false,
          deletion: deletion({
            failure: { ...zeropsRefusal, code: "token_expired", origin: "hq" },
            continueBy: "person",
          }),
        }),
      },
      "standing",
    ],
    ["failed", { project: bakery({ deletion: deletion({ failure: zeropsRefusal }) }) }, "standing"],
    [
      "failed, another Mate",
      {
        mate: MATE,
        project: bakery({
          placements: [...bakery().placements, other],
          deletion: deletion({ failure: zeropsRefusal }),
        }),
      },
      "mate",
    ],
    [
      "failed, another birth",
      {
        mate: MATE,
        project: bakery({ births: [null], deletion: deletion({ failure: zeropsRefusal }) }),
      },
      "mate",
    ],
    [
      "failed, another Mate without project Delete",
      {
        mate: MATE,
        project: bakery({
          placements: [...bakery().placements, other],
          deleteApp: false,
          deletion: deletion({ failure: zeropsRefusal }),
        }),
      },
      "mate",
    ],
    [
      "failed, last Mate without project Delete",
      {
        mate: MATE,
        project: bakery({ deleteApp: false, deletion: deletion({ failure: zeropsRefusal }) }),
      },
      "last-mate-only",
    ],
    [
      "failed, last Mate with project Delete",
      { mate: MATE, project: bakery({ deletion: deletion({ failure: zeropsRefusal }) }) },
      "standing",
    ],
    [
      "past failure",
      {
        project: bakery({ placements: [], deletion: deletion({ failure: zeropsRefusal }) }),
        past: "op-1",
      },
      "project",
    ],
    [
      "different failure",
      {
        project: bakery({ deletion: deletion({ id: "op-2", failure: zeropsRefusal }) }),
        past: "op-1",
      },
      "standing",
    ],
    [
      "Mate is birth",
      { mate: MATE, project: bakery({ placements: [], births: [MATE.projectId] }) },
      "project",
    ],
  ];
  for (const [label, facts, kind] of cases) expect(deletionOffer(facts).kind, label).toBe(kind);
  const failed = deletion({ failure: zeropsRefusal });
  const single = deletionOffer({
    mate: MATE,
    project: bakery({ placements: [...bakery().placements, other], deletion: failed }),
  });
  expect(deletionStart({ orgId: "org", id: "new", offer: single })).toEqual({
    kind: "start-mate-deletion",
    orgId: "org",
    id: "new",
    projectId: MATE.projectId,
  });
  const last = deletionOffer({
    mate: MATE,
    project: bakery({ deleteApp: false, deletion: failed }),
  });
  expect(deletionStart({ orgId: "org", id: "new", offer: last })).toEqual({
    kind: "start-mate-deletion",
    orgId: "org",
    id: "new",
    projectId: MATE.projectId,
    keptGit: "keep",
  });
  const restricted = deletionOffer({
    mate: MATE,
    project: bakery({ deleteApp: false, placements: [...bakery().placements, plain] }),
  });
  expect(restricted.kind === "last-mate-only" && restricted.stays).toContain("Zerops project");
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | failedDeletion: offer.deletion, → failedDeletion: undefined,
it("MN110: An Admin who cannot press Delete again sees a failed project deletion above a fresh form, while a reader offered Delete again or unable to delete the project sees the failure; breaks: an Admin cannot start a fresh deletion after the project deletion failed.", () => {
  const failed = deletion({ failure: zeropsRefusal });
  const retryable = deletion({ failure: zeropsRefusal, offers: ["again"] });
  const cases = [
    { project: bakery({ deletion: failed }), mate: MATE, kind: "form", failure: failed },
    {
      project: bakery({ placements: [], deletion: failed }),
      mate: undefined,
      kind: "form",
      failure: failed,
    },
    { project: bakery({ deletion: retryable }), mate: MATE, kind: "standing", failure: undefined },
    {
      project: bakery({ placements: [], deleteApp: false, deletion: failed }),
      mate: undefined,
      kind: "standing",
      failure: undefined,
    },
  ] as const;
  for (const row of cases) {
    const state = deletionPageState({ structureRead: true, project: row.project, mate: row.mate });
    expect(state.kind).toBe(row.kind);
    if (state.kind === "form") {
      expect(state.offer.kind).toBe("project");
      expect(state.offer.mate).toEqual(row.mate);
      expect(state.failedDeletion).toEqual(row.failure);
      expect(
        deletionStart({
          orgId: "org",
          id: "new",
          offer: state.offer,
          review: review(row.project, row.mate),
        })?.kind,
      ).toBe("start-app-deletion");
    } else if (state.kind === "standing") {
      expect(state.offer.deletion).toEqual(row.project.deletion);
    }
  }

  const mateStep = { part: "mate", projectId: MATE.projectId, state: "pending" } as const;
  const another = { projectId: "Z_OAT", kind: "mate", name: "Oat", deletable: true };
  const projectCases = [
    {
      project: bakery({
        placements: [...bakery().placements, another],
        deletion: failed,
        steps: [mateStep],
      }),
      kind: "form",
      expectedMate: undefined,
      blocked: true,
    },
    {
      project: bakery({
        placements: [...bakery().placements, another],
        deletion: retryable,
        steps: [mateStep],
      }),
      kind: "standing",
      expectedMate: undefined,
      blocked: false,
    },
    {
      project: bakery({
        placements: [...bakery().placements, another],
        deletion: retryable,
        steps: [mateStep],
      }),
      past: "op-1",
      kind: "form",
      expectedMate: undefined,
      blocked: true,
    },
    {
      project: bakery({ deleteApp: false, deletion: failed, steps: [mateStep] }),
      kind: "standing",
      expectedMate: undefined,
      blocked: false,
    },
    {
      project: bakery({ deletion: failed, steps: [mateStep] }),
      kind: "form",
      expectedMate: MATE,
      blocked: false,
    },
    {
      project: bakery({ deletion: retryable, steps: [mateStep] }),
      past: "op-1",
      kind: "form",
      expectedMate: MATE,
      blocked: false,
    },
  ] as const;
  for (const row of projectCases) {
    const mateId = deletionPageMate({ project: row.project, address: undefined });
    expect(mateId).toBe(MATE.projectId);
    const state = deletionPageState({
      structureRead: true,
      project: row.project,
      mate: undefined,
      formMate: mateId === undefined ? undefined : MATE,
      past: "past" in row ? row.past : undefined,
    });
    expect(state.kind).toBe(row.kind);
    if (state.kind === "form") {
      expect(state.offer.mate).toEqual(row.expectedMate);
      const current = review(state.project, state.offer.mate);
      expect(current.missing).toBe(
        row.blocked ? "A Mate still works on this project. Delete it first." : null,
      );
      expect(
        deletionStart({ orgId: "org", id: "new", offer: state.offer, review: current })?.kind,
      ).toBe(row.blocked ? undefined : "start-app-deletion");
    } else if (state.kind === "standing") {
      expect(state.offer.deletion).toEqual(row.project.deletion);
    }
  }
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | JSON.stringify(left.keepRepos ?? []) === JSON.stringify(right.keepRepos ?? []) → true
it("MN84: The page's Delete sends one start: the project's deletion naming its Mate and exactly the Zerops projects, Stages and Productions set to go, with the code kept where nothing of it stays in Zerops, or the Mate's own deletion keeping the project when nothing but the Mate goes; breaks: a part set to stay is deleted, one set to go is left, or the Mate and the project are deleted by two starts.", () => {
  const project = bakery({
    placements: [
      ...bakery().placements,
      { projectId: "p", kind: "plain", name: "plain", deletable: true },
    ],
    environments: [
      stage("Z_STAGE"),
      production("made"),
      production("attached", { madeByMate: false }),
    ],
  });
  const rows = [
    {
      selected: choice({ Z_STAGE: "stays" }),
      kind: "start-mate-deletion",
      expected: { projectId: MATE.projectId, keptGit: "keep" },
    },
    {
      selected: choice(),
      kind: "start-app-deletion",
      expected: { mate: MATE.projectId, stages: ["Z_STAGE"] },
    },
    {
      selected: choice(
        { p: "goes", made: "goes", attached: "goes" },
        { p: true, made: true },
        "bakery",
        { web: "stays" },
      ),
      kind: "start-app-deletion",
      expected: {
        mate: MATE.projectId,
        stages: ["Z_STAGE"],
        plains: ["p"],
        productions: ["made", "attached"],
        keepRepos: ["web"],
      },
    },
  ] as const;
  for (const row of rows) {
    const result = review(project, MATE, row.selected);
    const start = deletionStart({
      orgId: "org",
      id: "op",
      offer: deletionOffer({ project, mate: MATE }),
      review: result,
    });
    expect(start?.kind).toBe(row.kind);
    expect(start).toMatchObject(row.expected);
    if (row.kind === "start-app-deletion" && row.selected.fates.p !== "goes")
      expect(start).not.toHaveProperty("keepRepos");
  }
  const base = deletionStart({
    orgId: "org",
    id: "one",
    offer: deletionOffer({ project, mate: MATE }),
    review: review(project, MATE, rows[2].selected),
  })!;
  if (base.kind !== "start-app-deletion") throw new Error("expected application start");
  expect(sameDeletionStart(base, { ...base, id: "two" })).toBe(true);
  expect(sameDeletionStart(base, { ...base, plains: ["other"] })).toBe(false);
  expect(sameDeletionStart(base, { ...base, keepRepos: ["docs"] })).toBe(false);
  expect(sameDeletionStart(base, { ...base, stages: [] })).toBe(false);
  expect(sameDeletionStart(base, { ...base, productions: [] })).toBe(false);

  const sameId = bakery({ placements: [], environments: [stage("docs")] });
  const initial = review(sameId, undefined);
  const code = initial.rows.find((row) => row.kind === "code" && row.id === "docs")!;
  const keptCode = chooseDeletionFate(choice(), code, "stays");
  const selected = review(sameId, undefined, keptCode);
  expect(selected.rows.find((row) => row.kind === "stage")?.fate).toBe("goes");
  expect(selected.rows.find((row) => row.kind === "code" && row.id === "docs")?.fate).toBe("stays");
  expect(selected.start).toMatchObject({ stages: ["docs"], keepRepos: ["docs"] });
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | trimmed.length <= 100 → trimmed.length > 0
it("MN95: The project's deletion start carries the Zerops name the client holds for its last Mate, every Zerops project, Stage and Production, one that stays included, leaves out a name that is blank or over 100 characters, and two starts that differ only in names are one start; breaks: a stopped deletion cannot say which part went or stays, or one over-long name makes HQ refuse the whole deletion.", () => {
  const hundred = "x".repeat(100);
  const project = bakery({
    placements: [
      { projectId: MATE.projectId, kind: "mate", name: "  workspace  ", deletable: true },
      { projectId: "p", kind: "plain", name: "  plain  ", deletable: true },
    ],
    environments: [
      { ...stage("Z_STAGE"), name: " stage " },
      production("kept", { name: hundred }),
      production("long", { name: "x".repeat(101) }),
      production("blank", { name: "   " }),
    ],
  });
  const first = deletionStart({
    orgId: "org",
    id: "op",
    offer: deletionOffer({ project, mate: MATE }),
    review: review(project, MATE),
  });
  expect(first?.kind).toBe("start-app-deletion");
  if (first?.kind !== "start-app-deletion") throw new Error("expected application start");
  expect(first.names).toEqual({ Z_RYE: "workspace", p: "plain", Z_STAGE: "stage", kept: hundred });
  const renamed = { ...first, names: { ...first.names, p: "renamed" } };
  expect(sameDeletionStart(first, renamed)).toBe(true);
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | : holdings === undefined → : false
it("MN85: A project's Delete opens only once HQ has said its holdings, something is set to go and the project's name is typed; breaks: Delete opens with holdings unread, with nothing to delete, or without the project's name.", () => {
  const project = bakery({ environments: [stage("Z_STAGE"), production("live")] });
  const cases = [
    {
      label: "other Mate",
      project: bakery({ births: [null] }),
      held: holdings,
      selected: choice(),
      missing: "A Mate still works on this project. Delete it first.",
      ready: false,
    },
    {
      label: "holdings unread",
      project,
      held: undefined,
      selected: choice(),
      missing: "Reading what HQ holds.",
      ready: false,
    },
    {
      label: "nothing goes",
      project: bakery({ placements: [], environments: [production("live")] }),
      held: holdings,
      selected: choice(),
      missing: "Nothing is set to go.",
      ready: false,
      mate: undefined,
    },
    {
      label: "project unconfirmed",
      project,
      held: holdings,
      selected: choice({}, {}, ""),
      missing: null,
      ready: false,
    },
    {
      label: "ready",
      project,
      held: holdings,
      selected: choice(),
      missing: null,
      ready: true,
    },
  ] as const;
  for (const row of cases) {
    const result = deletionReview({
      project: row.project,
      mate: "mate" in row ? row.mate : MATE,
      holdings: row.held,
      choice: row.selected,
    });
    expect([result.missing, result.ready], row.label).toEqual([row.missing, row.ready]);
    if (row.missing !== null) expect(result.start).toBeUndefined();
  }
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
  const plain = deletionParts(
    bakery({
      deletion: deletion({ failure: zeropsRefusal }),
      steps: [
        { part: "plain", name: "plain-name", state: "deleting" },
        { part: "plain", state: "pending" },
        { part: "code", state: "pending", keeps: ["docs", "web"] },
      ],
    }),
  );
  expect(plain.map((part) => [part.label, part.state])).toEqual([
    ["Zerops project plain-name", "here"],
    ["A Zerops project", "here"],
    ["Its code, keeping docs and web", "here"],
  ]);
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | const again = deletion.again === true; → const again = true;
it("MN96: A project's deletion that ended failed offers Delete again only to a reader HQ offers it, and tells a reader who may not delete the project that only an Owner or an Admin can; breaks: an Admin presses a Delete again that Zerops refuses the same way, or a Member reads a stopped deletion with no word on who can go on.", () => {
  const token = { step: "token", code: "token_delete_refused", at: AT, origin: "hq" };
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly deleteApp: boolean;
    readonly operation: Partial<HqOperation>;
    readonly again: boolean;
    readonly who: boolean;
  }> = [
    {
      name: "Owner after token refusal",
      deleteApp: true,
      operation: { failure: token, offers: ["again"] },
      again: true,
      who: false,
    },
    {
      name: "Admin after token refusal",
      deleteApp: true,
      operation: { failure: token, offers: [] },
      again: false,
      who: false,
    },
    {
      name: "Admin after stage refusal",
      deleteApp: true,
      operation: { failure: zeropsRefusal, offers: ["again"] },
      again: true,
      who: false,
    },
    {
      name: "Member after token refusal",
      deleteApp: false,
      operation: { failure: token, offers: [] },
      again: false,
      who: true,
    },
    {
      name: "Member after stage refusal",
      deleteApp: false,
      operation: { failure: zeropsRefusal, offers: [] },
      again: false,
      who: true,
    },
    { name: "running", deleteApp: false, operation: {}, again: false, who: false },
    {
      name: "waiting",
      deleteApp: false,
      operation: { failure: token, continueBy: "maker", offers: ["continue"] },
      again: false,
      who: false,
    },
  ];
  for (const row of cases) {
    const standing = deletion(row.operation);
    if (standing.kind === "none" || standing.kind === "needs") throw new Error(row.name);
    const words = deletionStandingWords(bakery({ deleteApp: row.deleteApp }), standing);
    expect(words.again, row.name).toBe(row.again);
    expect(words.who !== null, row.name).toBe(row.who);
  }
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | return part.part === "kept" ? "Let go" : "Gone"; → return "Gone";
it("MN88: A Production Mate did not make that leaves the project is a part the deletion lets go of: it reads letting go while its part runs and let go once done, the project's line says letting go of it, a failed deletion lists it as let go apart from what is gone and as still here while it stands; breaks: a Production the person kept reads Deleting or Gone, or a deletion Zerops stopped at its deploy token names every part but that one.", () => {
  const steps = [
    { part: "kept_production", projectId: "Z_LIVE", name: "acme-live", state: "deleting" },
    { part: "mate", projectId: "Z_RYE", name: "Rye", state: "pending" },
    { part: "code", state: "pending" },
  ];
  const tokenExpired = { step: "token", code: "token_expired", origin: "hq", at: AT };
  const tokenRefused = { step: "token", code: "token_delete_refused", origin: "hq", at: AT };
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly steps: NonNullable<DeletionProject["steps"]>;
    readonly operation: Partial<HqOperation>;
    readonly parts: ReadonlyArray<readonly [string, string]>;
    readonly words: ReadonlyArray<string>;
    readonly line: string;
  }> = [
    {
      name: "letting go",
      steps,
      operation: {},
      parts: [
        ["kept", "Production acme-live"],
        ["mate", "Rye"],
        ["code", "Its code"],
      ],
      words: ["Letting go", "Waiting its turn", "Waiting its turn"],
      line: "Letting go of Production acme-live…",
    },
    {
      name: "waiting at the token",
      steps,
      operation: { failure: tokenExpired, continueBy: "u-theo" },
      parts: [
        ["kept", "Production acme-live"],
        ["mate", "Rye"],
        ["code", "Its code"],
      ],
      words: ["Stopped here", "Waiting its turn", "Waiting its turn"],
      line: "Deleting stopped at Production acme-live",
    },
    {
      name: "the token was refused",
      steps,
      operation: { failure: tokenRefused },
      parts: [
        ["kept", "Production acme-live"],
        ["mate", "Rye"],
        ["code", "Its code"],
      ],
      words: ["Still here", "Still here", "Still here"],
      line: "bakery was not deleted · Only an organization owner can delete this environment's deploy token. Still here: Production acme-live, Rye and its code.",
    },
    {
      name: "a Stage is also still here after the token was refused",
      steps: [
        steps[0]!,
        steps[1]!,
        { part: "stage", name: "acme-stage", state: "pending" },
        steps[2]!,
      ],
      operation: { failure: tokenRefused },
      parts: [
        ["kept", "Production acme-live"],
        ["mate", "Rye"],
        ["stage", "Stage acme-stage"],
        ["code", "Its code"],
      ],
      words: ["Still here", "Still here", "Still here", "Still here"],
      line: "bakery was not deleted · Only an organization owner can delete this environment's deploy token. Still here: Production acme-live, Rye, Stage acme-stage and its code.",
    },
    {
      name: "a later part was refused",
      steps: [
        { part: "kept_production", name: "acme-live", state: "gone" },
        { part: "mate", name: "Rye", state: "gone" },
        { part: "stage", name: "acme-stage", state: "deleting" },
        { part: "code", state: "pending" },
      ],
      operation: { failure: zeropsRefusal },
      parts: [
        ["kept", "Production acme-live"],
        ["mate", "Rye"],
        ["stage", "Stage acme-stage"],
        ["code", "Its code"],
      ],
      words: ["Let go", "Gone", "Still here", "Still here"],
      line: "bakery was not deleted · Zerops refused: Forbidden. Gone: Rye's workspace. Let go: Production acme-live. Still here: Stage acme-stage and its code.",
    },
    {
      name: "an unnamed Production",
      steps: [{ part: "kept_production", projectId: "Z_RYE", state: "deleting" }],
      operation: {},
      parts: [["kept", "A Production"]],
      words: ["Letting go"],
      line: "Letting go of a Production…",
    },
    {
      name: "a Production chosen for deletion",
      steps: [{ part: "production", name: "acme-live", state: "deleting" }],
      operation: {},
      parts: [["production", "Production acme-live"]],
      words: ["Deleting"],
      line: "Deleting Production acme-live…",
    },
  ];
  for (const row of cases) {
    const operation = deletion(row.operation);
    if (operation.kind !== "going" && operation.kind !== "waiting" && operation.kind !== "failed")
      throw new Error(`Unexpected deletion state in ${row.name}: ${operation.kind}`);
    const project = bakery({ steps: row.steps, deletion: operation });
    const parts = deletionParts(project);
    expect(
      parts.map((part) => [part.part, part.label]),
      row.name,
    ).toEqual(row.parts);
    expect(parts.map(partStateWords), row.name).toEqual(row.words);
    expect(deletionStandingWords(project, operation).line, row.name).toBe(row.line);
  }
  expect(partStateWords({ part: "kept", label: "A Production", state: "pending" })).toBe(
    "Waiting its turn",
  );
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | madeByMate: environment.deleteProjectOnRemoval === true, → madeByMate: false,
it("MN87: What HQ's structure says of a project becomes the deletion's facts one to one: a Zerops project, Stage or Production the person may delete as deletable, a Production a Mate made as made by a Mate, the right to delete the project, hidden tiers, and a project nobody names without a name; breaks: an attached Production is offered for deletion and HQ refuses it, or a Production is unlocked by typing a placeholder.", () => {
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
          { projectId: "plain", kind: "plain", name: "plain-name", can },
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
  const project = deletionProjectOf(structure, "app", { kind: "none" }, NO_ENVIRONMENTS)!;
  expect(project.deleteApp).toBe(true);
  expect(project.environmentRecordsRead).toBe(false);
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
  expect(project.placements[3]).toMatchObject({ projectId: "plain", deletable: true });
  expect(
    deletionProjectOf(
      { ...structure, can: { delete_app: { allow: false, reason: "denied" } } },
      "app",
      { kind: "none" },
      NO_ENVIRONMENTS,
    )?.deleteApp,
  ).toBe(false);
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | (kind === "stage" || kind === "production") && → kind === "production" &&
it("MN112: an unreadable Stage keeps the project in the menu, as does an unreadable Production, and an environment named by both its placement and its details is shown once; breaks: the page says a project is gone while a Stage or Production stays.", () => {
  for (const tier of ["stage", "production"] as const) {
    const structure = {
      can: { delete_app: { allow: true } },
      apps: [
        {
          id: "app",
          name: "bakery",
          projects: [
            { ...MATE, kind: "mate" },
            { projectId: "unread", kind: tier, name: "unread" },
          ],
          environments: [],
        },
      ],
    } as unknown as Pick<HqStructure, "can" | "apps">;
    const project = deletionProjectOf(
      structure,
      "app",
      { kind: "none" },
      {
        environments: [],
        unread: [{ id: "environment", name: "unread", tier }],
      },
    )!;
    const result = review(project, MATE);
    expect(project.environmentRecordsRead).toBe(true);
    expect(result.rows.find((row) => row.id === "unread")).toMatchObject({
      kind: tier,
      fate: "stays",
      switchable: false,
    });
    expect(result.becomes.place).toBe("menu");
    expect(result.rows.find((row) => row.id === "environment")).toMatchObject({
      kind: "environment",
      fate: "stays",
      switchable: false,
    });
    expect(result.rows.find((row) => row.id === "docs")?.fate).toBe("stays");
    expect(result.start).toEqual({
      kind: "start-mate-deletion",
      projectId: MATE.projectId,
      keptGit: "keep",
    });
  }

  const readable = {
    apps: [
      {
        id: "app",
        name: "bakery",
        projects: [{ projectId: "stage", kind: "stage", name: "stage" }],
        environments: [{ tier: "stage", target: { kind: "zerops", projectId: "stage" } }],
      },
    ],
  } as unknown as Pick<HqStructure, "can" | "apps">;
  const project = deletionProjectOf(readable, "app", { kind: "none" }, NO_ENVIRONMENTS)!;
  expect(review(project, undefined).rows.filter((row) => row.kind === "stage")).toHaveLength(1);
  const hidden = {
    apps: [
      {
        id: "app",
        name: "bakery",
        projects: [{ projectId: "stage", kind: "stage", name: "stage" }],
        environments: [],
        hiddenEnvironments: [{ id: "stage", tier: "stage" }],
      },
    ],
  } as unknown as Pick<HqStructure, "can" | "apps">;
  const hiddenProject = deletionProjectOf(hidden, "app", { kind: "none" }, NO_ENVIRONMENTS)!;
  const hiddenReview = review(hiddenProject, undefined);
  expect(hiddenReview.rows.filter((row) => row.kind === "stage")).toHaveLength(1);
  expect(hiddenReview.becomes.place).toBe("menu");
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | if (offer.kind === "project" && !input.project.deleteApp) → if (offer.kind === "project" && false)
it("MN91: A project's deletion page shows what the person may do there: its form to an Owner or an Admin, with the project's last Mate when it is given one; why not to anyone else or for a Mate that is not its last; HQ's run, wait or stop to every reader; and that the project is gone once HQ holds it no more; breaks: a Member's address opens a form HQ then refuses, or a stopped deletion is hidden from a colleague.", () => {
  const empty = bakery({ placements: [], environments: [] });
  const waiting = deletion({
    failure: { ...zeropsRefusal, code: "token_expired", origin: "hq" },
    continueBy: "user",
  });
  const failed = deletion({ failure: zeropsRefusal });
  const cases = [
    { read: false, project: undefined, mate: undefined, kind: "reading" },
    { read: true, project: undefined, mate: undefined, kind: "gone" },
    { read: true, project: empty, mate: undefined, kind: "form" },
    { read: true, project: { ...empty, deleteApp: false }, mate: undefined, kind: "refused" },
    { read: true, project: bakery(), mate: MATE, kind: "form" },
    {
      read: true,
      project: bakery({
        placements: [
          ...bakery().placements,
          { projectId: "other", kind: "mate", name: undefined, deletable: true },
        ],
      }),
      mate: MATE,
      kind: "refused",
    },
    { read: true, project: bakery({ deleteApp: false }), mate: MATE, kind: "refused" },
    {
      read: true,
      project: bakery({ environments: [stage("stage", false)] }),
      mate: MATE,
      kind: "form",
    },
    { read: true, project: bakery(), mate: undefined, kind: "form", held: true },
    {
      read: true,
      project: { ...empty, deleteApp: false, deletion: deletion({}) },
      mate: undefined,
      kind: "standing",
    },
    {
      read: true,
      project: { ...empty, deleteApp: false, deletion: waiting },
      mate: undefined,
      kind: "standing",
    },
    {
      read: true,
      project: { ...empty, deleteApp: false, deletion: failed },
      mate: undefined,
      kind: "standing",
    },
    { read: true, project: { ...empty, deletion: failed }, mate: MATE, past: "op-1", kind: "form" },
  ] as const;
  for (const row of cases) {
    const state = deletionPageState({
      structureRead: row.read,
      project: row.project,
      mate: row.mate,
      past: "past" in row ? row.past : undefined,
    });
    expect(state.kind).toBe(row.kind);
    if ("held" in row)
      expect(state.kind === "form" && review(state.project, undefined).missing).toBe(
        "A Mate still works on this project. Delete it first.",
      );
    if ("past" in row) expect(state.kind === "form" && state.offer.kind).toBe("project");
  }
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | return mate?.projectId ?? address; → return address;
it("MN98: Delete again over a project's deletion that ended failed makes its form with the Mate that deletion's start named, whatever the page's address names, and every other page takes its Mate from the address alone; breaks: an Owner finishing a deletion Zerops refused an Admin reads that a Mate still works on the project and cannot delete it, or a project's own Delete takes a Mate nobody chose.", () => {
  const tokenRefused = { step: "token", code: "token_delete_refused", at: AT, origin: "hq" };
  const failed = deletion({ failure: tokenRefused, offers: ["again"] });
  const mateStep = { part: "mate", projectId: MATE.projectId, state: "pending" };
  const cases = [
    { project: bakery(), address: MATE.projectId, expected: MATE.projectId },
    { project: bakery(), address: undefined, expected: undefined },
    {
      project: bakery({ deletion: deletion({}), steps: [mateStep] }),
      address: undefined,
      expected: undefined,
    },
    {
      project: bakery({
        deletion: deletion({ failure: tokenRefused, continueBy: "maker" }),
        steps: [mateStep],
      }),
      address: undefined,
      expected: undefined,
    },
    {
      project: bakery({ deletion: failed, steps: [mateStep] }),
      address: undefined,
      expected: MATE.projectId,
    },
    {
      project: bakery({ deletion: failed, steps: [mateStep] }),
      address: "other",
      expected: MATE.projectId,
    },
    {
      project: bakery({
        deletion: failed,
        steps: [{ part: "stage", projectId: "Z_STAGE", state: "pending" }],
      }),
      address: "other",
      expected: "other",
    },
    { project: bakery({ deletion: failed }), address: undefined, expected: undefined },
    { project: undefined, address: "other", expected: "other" },
  ];
  for (const { project, address, expected } of cases)
    expect(deletionPageMate({ project, address })).toBe(expected);

  const steps: NonNullable<DeletionProject["steps"]> = [
    { part: "kept_production", projectId: "Z_LIVE", state: "pending" },
    mateStep,
    { part: "stage", projectId: "Z_STAGE", state: "pending" },
    { part: "code", state: "pending" },
  ];
  const project = bakery({
    deletion: failed,
    environments: [stage("Z_STAGE"), production("Z_LIVE")],
    steps,
  });
  const afterMate = {
    ...project,
    placements: project.placements.filter(({ projectId }) => projectId !== MATE.projectId),
    steps: steps.map((step) => (step.part === "mate" ? { ...step, state: "gone" } : step)),
  };
  const start = {
    kind: "start-app-deletion",
    orgId: "org",
    id: "op",
    appId: project.appId,
    stages: ["Z_STAGE"],
  } as const;
  const pageCases = [
    { project, past: undefined, state: "standing", offer: undefined, start: undefined },
    {
      project,
      past: "op-1",
      state: "form",
      offer: "project",
      start: {
        ...start,
        mate: MATE.projectId,
        names: { Z_STAGE: "z_stage", Z_LIVE: "z_live", Z_RYE: "Rye" },
      },
    },
    {
      project: afterMate,
      past: "op-1",
      state: "form",
      offer: "project",
      start: { ...start, names: { Z_STAGE: "z_stage", Z_LIVE: "z_live" } },
    },
  ] as const;
  for (const row of pageCases) {
    const mateId = deletionPageMate({ project: row.project, address: undefined });
    expect(mateId).toBe(MATE.projectId);
    const state = deletionPageState({
      structureRead: true,
      project: row.project,
      mate: undefined,
      formMate: mateId === undefined ? undefined : { projectId: mateId, name: MATE.name },
      past: row.past,
    });
    expect(state.kind).toBe(row.state);
    if (state.kind !== "standing" && state.kind !== "form")
      throw new Error("Unexpected page state");
    if (state.kind === "form") expect(state.offer.kind).toBe(row.offer);
    else expect(state.offer.deletion).toMatchObject({ kind: "failed", again: true });
    expect(
      deletionStart({
        orgId: "org",
        id: "op",
        offer: state.offer,
        review: state.kind === "form" ? review(row.project, state.offer.mate, choice()) : undefined,
      }),
    ).toEqual(row.start);
  }
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | const hiddenParts: DeletionProject["hidden"] = project.hidden; → const hiddenParts: DeletionProject["hidden"] = [];
it("MN93: After a Delete that leaves the project standing the person is told where it waits: in the menu when it keeps a Zerops project, a Stage or a Production, listed or hidden, and under Git, Kept code when it holds only its code, and only that one is offered Open in Git; breaks: a person deletes the last Mate and cannot find the project to delete the rest.", () => {
  const cases = [
    { project: bakery({ environments: [stage("stage")] }), place: "menu" },
    { project: bakery({ environments: [production("live")] }), place: "menu" },
    {
      project: bakery({
        placements: [{ projectId: "p", kind: "plain", name: "plain", deletable: true }],
        environments: [],
      }),
      place: "menu",
    },
    { project: bakery({ placements: [], environments: [], hidden: ["stage"] }), place: "menu" },
    {
      project: bakery({ placements: [], environments: [], hidden: ["production"] }),
      place: "menu",
    },
    { project: bakery({ placements: [], environments: [] }), place: "git" },
  ] as const;
  for (const row of cases) {
    const result = deletionReview({
      project: row.project,
      holdings: undefined,
      choice: everythingStays(row.project),
    });
    expect(result.becomes.place).toBe(row.place);
  }
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | const defaultFate = kind === "stage" && switchable ? "goes" : "stays"; → const defaultFate = (kind === "stage" || kind === "production") && switchable ? "goes" : "stays";
it("MN100: A project's deletion page lists every part it holds, going or staying by default (its Mate, its Stages and its code go; a Production and a Zerops project without a Mate stay) and switchable only where the person may delete that part and HQ can leave or keep it: the Mate always goes, a part that is not theirs stays, and code stays while anything of the project stays in Zerops; breaks: a Production goes that nobody set to go, a part of someone else's is offered a switch HQ refuses, or code reads as going from a project that stays.", () => {
  const plain = { projectId: "p", kind: "plain", name: "plain", deletable: true };
  const rows = [
    {
      label: "Mate",
      project: bakery({ placements: [], environments: [] }),
      mate: MATE,
      id: MATE.projectId,
      fate: "goes",
      switchable: false,
    },
    {
      label: "plain admin",
      project: bakery({ placements: [plain], environments: [] }),
      id: "p",
      fate: "stays",
      switchable: true,
    },
    {
      label: "plain not admin",
      project: bakery({ placements: [{ ...plain, deletable: false }], environments: [] }),
      id: "p",
      fate: "stays",
      switchable: false,
    },
    {
      label: "plain unnamed",
      project: bakery({ placements: [{ ...plain, name: undefined }], environments: [] }),
      id: "p",
      fate: "stays",
      switchable: false,
    },
    {
      label: "Stage admin",
      project: bakery({ placements: [], environments: [stage("s")] }),
      id: "s",
      fate: "goes",
      switchable: true,
    },
    {
      label: "Stage not admin",
      project: bakery({ placements: [], environments: [stage("s", false)] }),
      id: "s",
      fate: "stays",
      switchable: false,
    },
    {
      label: "Stage unnamed",
      project: bakery({ placements: [], environments: [{ ...stage("s"), name: undefined }] }),
      id: "s",
      fate: "stays",
      switchable: false,
    },
    {
      label: "Stage blank",
      project: bakery({ placements: [], environments: [{ ...stage("s"), name: "   " }] }),
      id: "s",
      fate: "stays",
      switchable: false,
    },
    {
      label: "hidden Stage",
      project: bakery({ placements: [], environments: [], hidden: ["stage"] }),
      id: "hidden:stage:0",
      fate: "stays",
      switchable: false,
    },
    {
      label: "made Production",
      project: bakery({ placements: [], environments: [production("prod")] }),
      id: "prod",
      fate: "stays",
      switchable: true,
    },
    {
      label: "made Production not admin",
      project: bakery({ placements: [], environments: [production("prod", { deletable: false })] }),
      id: "prod",
      fate: "stays",
      switchable: false,
    },
    {
      label: "made Production unnamed",
      project: bakery({ placements: [], environments: [production("prod", { name: undefined })] }),
      id: "prod",
      fate: "stays",
      switchable: false,
    },
    {
      label: "hidden Production",
      project: bakery({ placements: [], environments: [], hidden: ["production"] }),
      id: "hidden:production:0",
      fate: "stays",
      switchable: false,
    },
    {
      label: "external Production",
      project: bakery({
        placements: [],
        environments: [production("prod", { madeByMate: false, deletable: false })],
      }),
      id: "prod",
      fate: "stays",
      switchable: true,
    },
    {
      label: "code keep offered",
      project: bakery({ placements: [], environments: [] }),
      id: "docs",
      fate: "goes",
      switchable: true,
    },
    {
      label: "code keep not offered",
      project: bakery({ placements: [], environments: [] }),
      id: "locked",
      fate: "goes",
      switchable: false,
      held: { repos: [{ name: "locked", canKeep: false }], openChanges: 0 },
    },
    {
      label: "code while part stays",
      project: bakery({ placements: [plain], environments: [] }),
      id: "docs",
      fate: "stays",
      switchable: false,
    },
    {
      label: "setup goes",
      project: bakery({ placements: [], environments: [] }),
      id: "group",
      fate: "goes",
      switchable: false,
    },
    {
      label: "setup stays",
      project: bakery({ placements: [plain], environments: [] }),
      id: "group",
      fate: "stays",
      switchable: false,
    },
  ] as const;
  for (const row of rows) {
    const result = review(
      row.project,
      "mate" in row ? row.mate : undefined,
      choice(),
      "held" in row ? row.held : holdings,
    );
    const part = result.rows.find((part) => part.id === row.id);
    expect([part?.fate, part?.switchable], row.label).toEqual([row.fate, row.switchable]);
  }
  const blocked = review(
    bakery({
      placements: [{ ...plain, deletable: false }],
      environments: [stage("s", false), production("prod", { deletable: false })],
    }),
    undefined,
    choice({ p: "goes", s: "goes", prod: "goes" }, {}, "bakery", { docs: "goes" }),
  );
  expect(blocked.rows.find((row) => row.id === "p")).toMatchObject({
    fate: "stays",
    line: "You are not an Admin of it.",
  });
  expect(blocked.rows.find((row) => row.id === "s")).toMatchObject({
    fate: "stays",
    line: "You are not an Admin of it.",
  });
  expect(blocked.rows.find((row) => row.id === "prod")).toMatchObject({
    fate: "stays",
    line: "You are not an Admin of it.",
  });
  expect(blocked.rows.find((row) => row.id === "docs")).toMatchObject({
    fate: "stays",
    line: "Stays while the project keeps something in Zerops.",
  });
  const selected = review(
    bakery({ placements: [plain], environments: [production("prod")] }),
    undefined,
    choice({ p: "goes", prod: "goes" }),
  );
  expect(selected.rows.find((row) => row.id === "p")).toMatchObject({
    fate: "goes",
    line: "Goes from Zerops, with everything in it",
  });
  expect(selected.rows.find((row) => row.id === "prod")).toMatchObject({
    fate: "goes",
    line: "Goes from Zerops, with its services and data",
  });
  const kept = review(
    bakery({ placements: [], environments: [] }),
    undefined,
    codeChoice({ docs: "stays" }),
  );
  expect(kept.rows.find((row) => row.id === "group")).toMatchObject({
    fate: "stays",
    switchable: false,
  });
  const specialNames: ApplicationHoldings = {
    repos: [
      { name: "constructor", canKeep: true },
      { name: "toString", canKeep: true },
    ],
    openChanges: 0,
  };
  const emptyProject = bakery({ placements: [], environments: [] });
  const defaults = review(emptyProject, undefined, choice(), specialNames);
  // The sentence checker also scans this member access as a valid identifier.
  const constructor = defaults.rows.find((row) => row.kind === "code" && row.id === "constructor")!;
  expect(constructor.fate).toBe("goes");
  expect(defaults.rows.find((row) => row.id === "toString")?.fate).toBe("goes");
  const specialChoice = chooseDeletionFate(choice(), constructor, "stays");
  const specialReview = review(emptyProject, undefined, specialChoice, specialNames);
  expect(specialReview.rows.find((row) => row.id === "constructor")?.fate).toBe("stays");
  expect(specialReview.start).toMatchObject({ keepRepos: ["constructor"] });
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | takes it offline at once and can't be undone. → takes it offline at once. Its services have backups.
it("MN108: the live warning says only that it goes offline at once for good; breaks: the warning promises backups for services without them", () => {
  const selected = review(
    bakery({ placements: [], environments: [production("prod")] }),
    undefined,
    choice({ prod: "goes" }),
  );
  expect(selected.rows.find((row) => row.id === "prod")?.warning).toBe(
    "Deleting Production prod takes it offline at once and can't be undone.",
  );
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | fate: recordsStay ? "stays" : "goes", → fate: "stays",
it("MN101: What the person set says what the project becomes, and the summary agrees: it stays in the menu without a Mate while a Zerops project, Stage or Production stays, waits under Git, Kept code when only code stays, and is gone when nothing does; Git and outside environment records leave when HQ removes them and stay when it retains them; breaks: the page says a project is deleted that stays in the menu, lists kept code under Goes, or promises a record HQ removes will remain.", () => {
  const cases = [
    {
      label: "Stage stays",
      project: bakery(),
      selected: choice({ Z_STAGE: "stays" }),
      place: "menu",
      stays: "Stage z_stage",
    },
    {
      label: "hidden Production",
      project: bakery({ placements: [], environments: [], hidden: ["production"] }),
      selected: choice(),
      place: "menu",
      stays: "A Production",
    },
    {
      label: "plain stays",
      project: bakery({
        placements: [{ projectId: "p", kind: "plain", name: "plain", deletable: true }],
        environments: [],
      }),
      selected: choice(),
      place: "menu",
      stays: "Zerops project plain",
    },
    {
      label: "made Production stays",
      project: bakery({ placements: [], environments: [production("prod")] }),
      selected: choice(),
      place: "menu",
      stays: "Production prod",
    },
    {
      label: "one repository kept",
      project: bakery({ placements: [], environments: [] }),
      selected: codeChoice({ docs: "stays" }),
      place: "git",
      stays: "Repository docs",
    },
    {
      label: "nothing stays",
      project: bakery({ placements: [], environments: [] }),
      selected: choice(),
      place: "gone",
      stays: undefined,
    },
    {
      label: "external Production leaves",
      project: bakery({
        placements: [],
        environments: [production("attached", { madeByMate: false })],
      }),
      selected: choice({ attached: "goes" }),
      place: "gone",
      stays: undefined,
    },
  ] as const;
  for (const row of cases) {
    const result = review(row.project, undefined, row.selected);
    expect(result.becomes.place, row.label).toBe(row.place);
    if (row.stays !== undefined) {
      expect(result.stays, row.label).toContain(row.stays);
      expect(result.goes, row.label).not.toContain(row.stays);
    }
    if (row.label === "external Production leaves")
      expect(result.goes).toContain(
        "Production attached stays in Zerops and keeps running. Mate lets go of it.",
      );
  }
  const gitStage = {
    id: "git-stage",
    tier: "stage",
    name: "review",
    target: { kind: "git", branch: "main", delivery: "direct" },
  };
  const externalVariants = [
    {
      ids: ["git-stage", "git-production"],
      read: {
        environments: [
          gitStage,
          {
            id: "git-production",
            tier: "production",
            name: "release",
            target: { kind: "git", branch: "release", delivery: "direct" },
          },
        ],
        unread: [],
      },
    },
    {
      ids: ["git-stage", "outside"],
      read: {
        environments: [gitStage],
        outside: {
          id: "outside",
          tier: "production",
          name: "external",
          target: { kind: "outside", address: null, setBy: "person", setAt: AT },
        },
        unread: [],
      },
    },
    {
      ids: ["git-stage", "unknown"],
      read: {
        environments: [gitStage],
        unread: [{ id: "unknown", tier: null, name: null }],
      },
    },
  ];
  const structure = (withStage: boolean) =>
    ({
      can: { delete_app: { allow: true } },
      apps: [
        {
          id: "app-bakery",
          name: "bakery",
          projects: [
            { ...MATE, kind: "mate" },
            ...(withStage ? [{ projectId: "stage", kind: "stage", name: "stage" }] : []),
          ],
          environments: withStage
            ? [
                {
                  tier: "stage",
                  target: { kind: "zerops", projectId: "stage" },
                  can: { delete_project: { allow: true } },
                },
              ]
            : [],
        },
      ],
    }) as unknown as Pick<HqStructure, "can" | "apps">;
  const externalCases = [
    {
      label: "everything goes",
      withStage: false,
      selected: choice(),
      fate: "goes",
      place: "gone",
      start: "start-app-deletion",
      stages: [],
    },
    {
      label: "Stage stays",
      withStage: true,
      selected: choice({ stage: "stays" }),
      fate: "stays",
      place: "menu",
      start: "start-mate-deletion",
      stages: undefined,
    },
    {
      label: "Stage goes but code stays",
      withStage: true,
      selected: choice({ stage: "goes" }, {}, "bakery", { docs: "stays" }),
      fate: "goes",
      place: "git",
      start: "start-app-deletion",
      stages: ["stage"],
    },
    {
      label: "only the Mate goes",
      withStage: false,
      selected: codeChoice({ docs: "stays", web: "stays" }),
      fate: "stays",
      place: "git",
      start: "start-mate-deletion",
      stages: undefined,
    },
  ] as const;
  for (const row of externalCases) {
    for (const variant of externalVariants) {
      const project = deletionProjectOf(
        structure(row.withStage),
        "app-bakery",
        { kind: "none" },
        variant.read as unknown as AppEnvironmentsRead,
      )!;
      const result = review(project, MATE, row.selected);
      for (const id of variant.ids) {
        expect(
          result.rows.find((part) => part.id === id),
          row.label,
        ).toMatchObject({
          kind: "environment",
          fate: row.fate,
          switchable: false,
        });
      }
      expect(result.becomes.place, row.label).toBe(row.place);
      expect(result.start?.kind, row.label).toBe(row.start);
      expect(result.start, row.label).toEqual(
        review({ ...project, environmentRecords: [] }, MATE, row.selected).start,
      );
      if (row.label === "only the Mate goes") {
        expect(result.mateStaysParts).toContain("Stage");
        const dialog = deletionReview({
          project,
          mate: MATE,
          holdings: undefined,
          choice: everythingStays(project),
        });
        expect(dialog.mateStaysParts).toContain("Stage");
      }
      if (result.start?.kind === "start-app-deletion") {
        expect(result.start.stages, row.label).toEqual(row.stages);
        expect(result.start.productions, row.label).toBeUndefined();
      }
    }
  }
  const split = review(
    bakery({ placements: [], environments: [] }),
    undefined,
    codeChoice({ docs: "stays" }),
  );
  expect(split.goes).toContain("Open changes in the repositories that go");
  expect(split.stays).toContain("Repository docs");
  const all = review(bakery({ placements: [], environments: [] }), undefined);
  expect(all.goes).toContain("2 open changes");
  const none = review(
    bakery({ placements: [], environments: [] }),
    undefined,
    codeChoice({ docs: "stays", web: "stays" }),
  );
  expect(none.goes).not.toContain("2 open changes");
  expect(none.goes).not.toContain("Open changes in the repositories that go");
  const onlySetup = review(bakery({ placements: [], environments: [] }), undefined, choice(), {
    repos: [{ name: "group", canKeep: false }],
    openChanges: 2,
  });
  expect(onlySetup.goes).toContain("2 open changes");
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | const steps: NonNullable<DeletionProject["steps"]> = project.steps ?? []; → const steps: NonNullable<DeletionProject["steps"]> = [];
it("MN102: Delete again starts from what the stopped deletion named: each part its steps name goes, every other part stays, and the code its code part kept is kept; breaks: a Stage the person kept goes on the second press, or kept code is deleted.", () => {
  const project = bakery({
    placements: [],
    environments: [stage("one"), stage("two")],
    steps: [
      { part: "stage", projectId: "one", state: "pending" },
      { part: "code", state: "pending", keeps: ["docs"] },
    ],
  });
  const selected = deletionChoiceAgain(project, holdings);
  expect(selected.fates).toMatchObject({ one: "goes", two: "stays" });
  expect(selected.repoFates).toMatchObject({ docs: "stays", web: "goes" });
  expect(selected.projectName).toBe("");
  const noCode = deletionChoiceAgain(
    { ...project, steps: [{ part: "stage", projectId: "one", state: "pending" }] },
    holdings,
  );
  expect(noCode.fates).toMatchObject({ one: "goes", two: "stays" });
  expect(noCode.repoFates).toMatchObject({ docs: "stays", web: "stays" });
  const late = deletionChoiceAgain(
    { ...project, environments: [], steps: [{ part: "code", state: "pending", keeps: ["docs"] }] },
    undefined,
  );
  const rows = review({ ...project, environments: [] }, undefined, late, holdings).rows;
  expect(rows.find((row) => row.id === "docs")?.fate).toBe("stays");
  expect(rows.find((row) => row.id === "web")?.fate).toBe("goes");
  const sameId = deletionChoiceAgain(
    {
      ...project,
      environments: [stage("docs")],
      steps: [
        { part: "stage", projectId: "docs", state: "pending" },
        { part: "code", state: "pending", keeps: ["docs"] },
      ],
    },
    holdings,
  );
  expect(sameId.fates.docs).toBe("goes");
  expect(sameId.repoFates.docs).toBe("stays");
  const specialNames: ApplicationHoldings = {
    repos: [
      { name: "constructor", canKeep: true },
      { name: "toString", canKeep: true },
    ],
    openChanges: 0,
  };
  const special = deletionChoiceAgain(
    { ...project, steps: [{ part: "code", state: "pending", keeps: ["constructor"] }] },
    specialNames,
  );
  expect(special.repoFates.constructor).toBe("stays");
  expect(special.repoFates.toString).toBe("goes");
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | const switchable = mate !== undefined && parts.length === 0 && repos.length === 0; → const switchable = false;
it("MN103: The setup files of a project whose only code they are, with nothing of it staying in Zerops, can be set to stay, and the last Mate's Delete is then the Mate's own deletion keeping the project under Git, Kept code; breaks: a person cannot delete only the last Mate of a project without a code repository.", () => {
  const project = bakery({
    placements: [{ projectId: "Z_RYE", kind: "mate", name: "Rye", deletable: true }],
    environments: [],
  });
  const setupOnly = { repos: [{ name: "group", canKeep: false }], openChanges: 0 };
  const withRepo = {
    repos: [
      { name: "group", canKeep: false },
      { name: "docs", canKeep: true },
    ],
    openChanges: 0,
  };
  const withStage = {
    ...project,
    placements: [
      ...project.placements,
      { projectId: "s", kind: "stage", name: "s", deletable: true },
    ],
    environments: [stage("s")],
  };
  const noCodeStep = deletionChoiceAgain({ ...project, steps: [] }, undefined);
  const cases = [
    {
      label: "setup only defaults to goes",
      project,
      held: setupOnly,
      selected: choice(),
      expected: ["goes", true],
    },
    {
      label: "setup only can stay",
      project,
      held: setupOnly,
      selected: codeChoice({ group: "stays" }),
      expected: ["stays", true],
    },
    {
      label: "a repository controls setup even after a choice to stay",
      project,
      held: withRepo,
      selected: codeChoice({ group: "stays" }),
      expected: ["goes", false],
    },
    {
      label: "a staying repository keeps setup",
      project,
      held: withRepo,
      selected: codeChoice({ docs: "stays", group: "goes" }),
      expected: ["stays", false],
    },
    {
      label: "a staying Stage keeps setup",
      project: withStage,
      held: setupOnly,
      selected: choice({ s: "stays" }, {}, "bakery", { group: "goes" }),
      expected: ["stays", false],
    },
    {
      label: "a staying plain project keeps setup",
      project: {
        ...project,
        placements: [
          ...project.placements,
          { projectId: "plain", kind: "plain" as const, name: "plain", deletable: true },
        ],
      },
      held: setupOnly,
      selected: codeChoice({ group: "goes" }),
      expected: ["stays", false],
    },
    {
      label: "a staying Production keeps setup",
      project: { ...project, environments: [production("prod")] },
      held: setupOnly,
      selected: codeChoice({ group: "goes" }),
      expected: ["stays", false],
    },
    {
      label: "a going Stage takes setup with the project",
      project: withStage,
      held: setupOnly,
      selected: codeChoice({ group: "stays" }),
      expected: ["goes", false],
    },
    {
      label: "a going plain project takes setup with the project",
      project: {
        ...project,
        placements: [
          ...project.placements,
          { projectId: "plain", kind: "plain" as const, name: "plain", deletable: true },
        ],
      },
      held: setupOnly,
      selected: choice({ plain: "goes" }, { plain: true }, "bakery", { group: "stays" }),
      expected: ["goes", false],
    },
    {
      label: "a going Production takes setup with the project",
      project: { ...project, environments: [production("prod")] },
      held: setupOnly,
      selected: choice({ prod: "goes" }, { prod: true }, "bakery", { group: "stays" }),
      expected: ["goes", false],
    },
    {
      label: "a staying Stage keeps setup when Production goes",
      project: { ...withStage, environments: [stage("s"), production("prod")] },
      held: setupOnly,
      selected: choice({ s: "stays", prod: "goes" }, { prod: true }, "bakery", {
        group: "goes",
      }),
      expected: ["stays", false],
    },
    {
      label: "delete again after no code step",
      project,
      held: setupOnly,
      selected: noCodeStep,
      expected: ["stays", true],
    },
    {
      label: "delete again after a code step that went",
      project,
      held: setupOnly,
      selected: { ...choice(), codeAgain: { hasStep: true, keeps: [] } },
      expected: ["goes", true],
    },
    {
      label: "delete again after a code step that kept setup",
      project,
      held: setupOnly,
      selected: { ...choice(), codeAgain: { hasStep: true, keeps: ["group"] } },
      expected: ["stays", true],
    },
    {
      label: "a new choice overrides delete again",
      project,
      held: setupOnly,
      selected: { ...noCodeStep, repoFates: { group: "goes" } },
      expected: ["goes", true],
    },
  ] as const;
  for (const row of cases) {
    const result = review(row.project, MATE, row.selected, row.held);
    const setup = result.rows.find((part) => part.kind === "setup");
    expect.soft([setup?.fate, setup?.switchable], row.label).toEqual(row.expected);
  }

  const initial = review(project, MATE, choice(), setupOnly);
  expect.soft(initial.start).toEqual({
    kind: "start-app-deletion",
    appId: "app-bakery",
    stages: [],
    mate: "Z_RYE",
    names: { Z_RYE: "Rye" },
  });
  const setup = initial.rows.find((row) => row.kind === "setup");
  if (setup === undefined) throw new Error("Missing setup row");
  const selected = chooseDeletionFate(choice({ group: "goes" }), setup, "stays");
  expect.soft(selected.repoFates).toEqual({ group: "stays" });
  expect.soft(selected.fates).toEqual({ group: "goes" });
  const kept = review(project, MATE, selected, setupOnly);
  expect.soft(kept.start).toEqual({
    kind: "start-mate-deletion",
    projectId: "Z_RYE",
    keptGit: "keep",
  });
  expect.soft(kept.becomes.place).toBe("git");
  expect.soft(kept.stays).toContain("Its setup files");
  expect.soft(kept.goes).not.toContain("Its setup files");

  const stageGoes = review(withStage, MATE, codeChoice({ group: "stays" }), setupOnly);
  expect.soft(stageGoes.ready).toBe(true);
  expect.soft(stageGoes.becomes.place).toBe("gone");
  expect.soft(stageGoes.goes).toContain("Its setup files");
  expect.soft(stageGoes.stays).not.toContain("Its setup files");
  expect.soft(stageGoes.start).toEqual({
    kind: "start-app-deletion",
    appId: "app-bakery",
    stages: ["s"],
    mate: "Z_RYE",
    names: { Z_RYE: "Rye", s: "s" },
  });

  const noMate = review(
    { ...project, placements: [] },
    undefined,
    codeChoice({ group: "stays" }),
    setupOnly,
  );
  const noMateSetup = noMate.rows.find((part) => part.kind === "setup");
  expect.soft([noMateSetup?.fate, noMateSetup?.switchable]).toEqual(["goes", false]);
  expect.soft(noMate.start).toEqual({
    kind: "start-app-deletion",
    appId: "app-bakery",
    stages: [],
  });
});

// witness: apps/web/src/components/zerops/deletion.logic.ts | if (fate === "stays") delete slid[row.id]; → if (fate === "stays" && row.slide === undefined) delete slid[row.id];
it("MN105: A part whose own data goes from Zerops for good asks a slide before Delete opens, every other part asks nothing, and a slide holds only for the fate it was slid for; breaks: Delete opens over a part nobody confirmed, or a part set back to stay and to go again is already confirmed.", () => {
  const project = bakery({
    placements: [
      { projectId: MATE.projectId, kind: "mate", name: "Rye", deletable: true },
      { projectId: "p", kind: "plain", name: "plain", deletable: true },
    ],
    environments: [stage("s"), production("live"), production("attached", { madeByMate: false })],
  });
  const stays = { p: "stays", s: "stays", live: "stays", attached: "stays" } as const;
  const onlyMate = bakery({ placements: [project.placements[0]!], environments: [] });
  const cases = [
    {
      label: "Production goes",
      fate: "goes",
      project,
      selected: choice({ ...stays, live: "goes" }),
      id: "live",
      slide: "Slide to delete Production live",
      missing: "Slide Production live to confirm it goes.",
    },
    {
      label: "plain goes",
      fate: "goes",
      project,
      selected: choice({ ...stays, p: "goes" }),
      id: "p",
      slide: "Slide to delete Zerops project plain",
      missing: "Slide Zerops project plain to confirm it goes.",
    },
    {
      label: "Production stays",
      fate: "stays",
      project,
      selected: choice(stays),
      id: "live",
      slide: undefined,
      missing: null,
    },
    {
      label: "plain stays",
      fate: "stays",
      project,
      selected: choice(stays),
      id: "p",
      slide: undefined,
      missing: null,
    },
    {
      label: "attached Production goes",
      fate: "goes",
      project,
      selected: choice({ ...stays, attached: "goes" }),
      id: "attached",
      slide: undefined,
      missing: null,
    },
    {
      label: "Stage goes",
      fate: "goes",
      project,
      selected: choice({ ...stays, s: "goes" }),
      id: "s",
      slide: undefined,
      missing: null,
    },
    {
      label: "Mate goes",
      fate: "goes",
      project,
      selected: choice(stays),
      id: MATE.projectId,
      slide: undefined,
      missing: null,
    },
    {
      label: "code goes",
      fate: "goes",
      project: onlyMate,
      selected: choice(),
      id: "docs",
      slide: undefined,
      missing: null,
    },
    {
      label: "setup goes",
      fate: "goes",
      project: onlyMate,
      selected: choice(),
      id: "group",
      slide: undefined,
      missing: null,
    },
  ] as const;
  for (const row of cases) {
    const result = review(row.project, MATE, row.selected);
    const part = result.rows.find((item) => item.id === row.id)!;
    expect(part.fate, row.label).toBe(row.fate);
    expect(part.slide?.label, row.label).toBe(row.slide);
    expect(result.missing, row.label).toBe(row.missing);
    expect(result.ready, row.label).toBe(row.missing === null);
    if (row.missing !== null) {
      expect(result.start, row.label).toBeUndefined();
      expect(part.slide?.confirmed, row.label).toBe(false);
      const confirmed = review(row.project, MATE, { ...row.selected, slid: { [row.id]: true } });
      expect(confirmed.rows.find((item) => item.id === row.id)?.slide?.confirmedLabel).toBe(
        `${part.title} goes`,
      );
      expect(confirmed.ready, row.label).toBe(true);
      expect(confirmed.start, row.label).toBeDefined();
    }
  }
  const both = choice({ ...stays, p: "goes", live: "goes" });
  expect(review(project, MATE, both).missing).toBe(
    "Slide Zerops project plain to confirm it goes.",
  );
  expect(review(project, MATE, { ...both, slid: { p: true } }).missing).toBe(
    "Slide Production live to confirm it goes.",
  );
  expect(review(project, MATE, { ...both, slid: { p: true, live: true } }).ready).toBe(true);
  const going = review(project, MATE, choice({ ...stays, live: "goes" }, { live: true }));
  const live = going.rows.find((row) => row.id === "live")!;
  const kept = chooseDeletionFate(
    choice({ ...stays, live: "goes" }, { live: true }),
    live,
    "stays",
  );
  const keptRow = review(project, MATE, kept).rows.find((row) => row.id === "live")!;
  const goesAgain = chooseDeletionFate(kept, keptRow, "goes");
  expect(review(project, MATE, goesAgain).missing).toBe(
    "Slide Production live to confirm it goes.",
  );
  const again = deletionChoiceAgain(
    { ...project, steps: [{ part: "production", projectId: "live", state: "pending" }] },
    holdings,
  );
  expect(again.fates.live).toBe("goes");
  expect(again.slid).toEqual({});
  expect(review(project, MATE, again).rows.find((row) => row.id === "live")?.slide?.confirmed).toBe(
    false,
  );
});
