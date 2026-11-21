import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG, processValue, zeropsVersion } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { historyScope } from "../families/process.ts";
import { makeAccountStore } from "../store.ts";
import { birthProgressOf, sharedBirths, type BirthEvidence } from "./birthProgress.ts";
const plan = {
  projectName: "Shop - Ada",
  recipe: { kind: "none" },
  agents: ["codex"],
  standUp: false,
  automated: false,
  placement: { role: "dev", name: "Ada", chief: false },
  location: null,
  userRoles: [],
};
const initial: BirthEvidence = {
  birth: { id: "birth", face: "rose:seal", madeBy: "ada", intent: plan, attempts: {} },
  viewer: "ada",
  projects: [],
  projectsCurrent: true,
  heldProjects: new Set(),
  projectHistoryCurrent: true,
  placement: "unknown",
  service: null,
};
const attempt = { by: "ada", at: "2026-11-05T10:00:00.000Z" };
function creationFinished(store: ReturnType<typeof makeAccountStore>) {
  const scope = historyScope(ORG, "p1");
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
  store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-read",
    members: ["create"],
    rows: [
      {
        family: "process",
        id: "create",
        value: processValue({
          id: "create",
          projectId: "p1",
          actionName: "project.create",
          status: "FINISHED",
        }),
        revision: zeropsVersion(1),
      },
    ],
  });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
}
// witness: packages/client-runtime/src/data/projections/birthProgress.ts | )?.allow === true, → )?.allow !== true,
it("PJ58: A bound birth offers Delete only to a project administrator", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [{ id: "p1", name: "Shop - Ada" }], services: [] }).forEach(
    store.dispatch,
  );
  creationFinished(store);
  membershipInputs("READ_ONLY", true).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          id: "app",
          name: "Shop",
          projects: [
            {
              projectId: "p1",
              name: "Shop - Ada",
              kind: "mate",
              mate: { face: "rose:seal", birthId: "birth" },
            },
          ],
          births: [{ ...initial.birth, projectId: "p1" }],
        },
      ],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  expect(registry.get(read).open).toMatchObject([{ canContinue: true, canDelete: false }]);
  membershipInputs("ADMIN", false, 2).forEach(store.dispatch);
  expect(registry.get(read).open).toMatchObject([{ canContinue: true, canDelete: true }]);
  stop();
  store.close();
  registry.dispose();
});
// witness: packages/client-runtime/src/data/projections/birthProgress.ts | reason: importFailure → reason: null
it("PJ59: An accepted import that failed blocks another import and keeps the platform's reason", () => {
  const failed = processValue({
    id: "i1",
    projectId: "p1",
    status: "FAILED",
    actionName: "stack.create",
    failReason: "No capacity.",
  });
  expect(
    birthProgressOf({
      ...initial,
      birth: {
        ...initial.birth,
        projectId: "p1",
        importProcessId: "i1",
        attempts: { create: attempt, import: attempt },
      },
      projects: [{ id: "p1", name: "Shop - Ada" }],
      importProcess: failed,
    }),
  ).toMatchObject({
    phase: "import-accepted",
    next: { kind: "blocked" },
    reason: "No capacity.",
  });
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | ...(birth.adopted === true ? { adopted: true as const } : {}), → ...(birth.adopted === true ? {} : {}),
it("PJ67: An adopted birth is marked adopted, so deleting it leaves its existing project", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [{ id: "p1", name: "Existing" }], services: [] }).forEach(
    store.dispatch,
  );
  membershipInputs("OWNER").forEach(store.dispatch);
  const adopted = { ...initial.birth, projectId: "p1", adopted: true };
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [{ id: "app", name: "Shop", projects: [], births: [adopted] }],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  expect(registry.get(read).open).toMatchObject([{ id: "birth", adopted: true, canDelete: true }]);
  stop();
  store.close();
  registry.dispose();
});

const acceptedAt = "2026-11-19T10:00:00.000Z";

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | if (operation !== undefined) { → if (operation !== undefined && operation.phase !== "project_ready") {
it("PJ93: A birth's operation offers Continue only to the person HQ names to continue it, whatever claims and presses its project shows", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({
    running: [],
    projects: [{ id: "p1", name: plan.projectName }],
    services: [],
  }).forEach(store.dispatch);
  creationFinished(store);
  membershipInputs("OWNER").forEach(store.dispatch);
  const navigation = (operation: NonNullable<BirthEvidence["birth"]["operation"]>) =>
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "app",
            name: "Shop",
            projects: [
              {
                projectId: "p1",
                name: plan.projectName,
                kind: "mate",
                mate: { face: "rose:seal", birthId: "birth" },
              },
            ],
            births: [
              { ...initial.birth, projectId: "p1", attempts: { create: attempt }, operation },
            ],
          },
        ],
        ungrouped: [],
      },
      presses: { p1: { kind: "mate", appId: "app", held: false } },
    });
  const births = () =>
    ["ada", "ben", "cyd"].map(
      (personId) =>
        registry.get(store.data.project(sharedBirths, { orgId: ORG, personId })).open[0],
    );
  const going = { kind: "birth" as const, phase: "project_ready" as const, acceptedAt };
  navigation({ ...going, at: "2026-11-19T10:01:00.000Z" });
  for (const birth of births()) {
    expect(birth?.canContinue).toBe(false);
    expect(birth?.progress).toEqual({
      phase: "project-created",
      next: { kind: "wait", for: "hq", attach: false },
      reason: null,
    });
    expect(birth?.startedAt).toBe(Date.parse(acceptedAt));
  }
  // Its maker made it, and HQ names someone else: HQ's word decides, never who made it.
  const at = "2026-11-19T10:02:00.000Z";
  navigation({
    ...going,
    at,
    failure: { step: "key", code: "token_expired", at },
    continueBy: "ben",
  });
  expect(
    births().map((birth) => [birth?.canContinue, birth?.progress.next.kind === "continue"]),
  ).toEqual([
    [false, false],
    [false, true],
    [false, false],
  ]);
  store.close();
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | reason: failure.code, → reason: null,
it("PJ92: A birth operation's failure is its stop reason, and it is never read as still going", () => {
  const progress = birthProgressOf({
    ...initial,
    birth: {
      ...initial.birth,
      operation: {
        kind: "birth",
        phase: "key_requested",
        acceptedAt,
        at: attempt.at,
        failure: { step: "key", code: "token_expired", at: attempt.at },
      },
    },
  });
  expect(progress).toEqual({
    phase: "project-created",
    next: { kind: "blocked" },
    reason: "token_expired",
    failedStep: "key",
  });
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | : { kind: "wait", for: "maker", attach: false }, → : { kind: "blocked" },
it("PJ+1: A birth operation waiting for its maker reads as theirs to continue, and as waiting for its maker to everyone else; breaks: the maker sees a blocked Mate with Delete as the only way out after their sign-in ran out", () => {
  const waiting = {
    ...initial,
    birth: {
      ...initial.birth,
      operation: {
        kind: "birth" as const,
        phase: "import_requested" as const,
        acceptedAt,
        at: attempt.at,
        failure: { step: "import" as const, code: "token_expired", at: attempt.at },
        continueBy: "ada",
      },
    },
  };
  expect([waiting, { ...waiting, viewer: "ben" }].map(birthProgressOf)).toEqual([
    {
      phase: "project-created",
      next: { kind: "continue" },
      reason: "token_expired",
      failedStep: "import",
    },
    {
      phase: "project-created",
      next: { kind: "wait", for: "maker", attach: false },
      reason: "token_expired",
      failedStep: "import",
    },
  ]);
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | const roleLive = membership.kind === "known" && read.stream(membership.scope).phase === "live"; → const roleLive = membership.kind === "known";
it("PJ96: A birth offers Continue and Delete only while its person's role is read live and allows them; breaks: a person whose role was taken or whose role read failed is offered a Continue or Delete Zerops refuses", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [], services: [] }).forEach(store.dispatch);
  membershipInputs("OWNER").forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [{ id: "app", name: "Shop", projects: [], births: [initial.birth] }],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  const actions = () =>
    registry.get(read).open.map(({ canContinue, canDelete }) => ({ canContinue, canDelete }));
  expect(actions()).toEqual([{ canContinue: true, canDelete: true }]);
  membershipInputs("READ_ONLY", false, 2).forEach(store.dispatch);
  expect(actions()).toEqual([{ canContinue: false, canDelete: false }]);
  membershipInputs("OWNER", false, 3).forEach(store.dispatch);
  expect(actions()).toEqual([{ canContinue: true, canDelete: true }]);
  store.dispatch({
    kind: "stream",
    key: `zerops:${ORG}:organization-user:${ORG}`,
    now: 4,
    event: { kind: "fault", fault: { outcome: "transient", message: "disconnected" }, jitter: 0 },
  });
  expect(actions()).toEqual([{ canContinue: false, canDelete: false }]);
  stop();
  store.close();
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | return matches.length === 1 → return matches.length >= 1
it("PJ97: A lost project answer binds only when a current project list shows exactly one project of the birth's name that nothing else holds; breaks: a birth whose create answer was lost binds a held project, one of two same-named projects, or one from a stale list", () => {
  const lost = { ...initial, birth: { ...initial.birth, attempts: { create: attempt } } };
  const arrived = { ...lost, projects: [{ id: "p1", name: plan.projectName }] };
  expect(
    [
      lost,
      arrived,
      { ...arrived, heldProjects: new Set(["p1"]) },
      { ...arrived, projectsCurrent: false },
      { ...arrived, projects: [...arrived.projects, { id: "p2", name: plan.projectName }] },
    ].map((evidence) => birthProgressOf(evidence).next),
  ).toEqual([
    { kind: "unknown", claimedAt: attempt.at },
    { kind: "bind", projectId: "p1" },
    { kind: "unknown", claimedAt: attempt.at },
    { kind: "unknown", claimedAt: attempt.at },
    { kind: "unknown" },
  ]);
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | return latest.time > claimAt → return latest.time < claimAt
it("PJ98: Only a refusal or a proven unsent outcome newer than its claim frees a birth's step, and an older one never frees a newer claim; breaks: a create is sent again while the newer one is still in flight, or a refused step is never offered again", () => {
  const outcome = (kind: "refused" | "unsent", at: string) =>
    birthProgressOf({
      ...initial,
      birth: {
        ...initial.birth,
        attempts: { create: { ...attempt, [kind]: { at, reason: "Quota reached." } } },
      },
    });
  for (const kind of ["refused", "unsent"] as const) {
    expect(outcome(kind, "2026-11-05T10:00:01.000Z")).toMatchObject({
      next: { kind: "create" },
      reason: "Quota reached.",
    });
    expect(outcome(kind, "2026-11-05T09:59:59.000Z").next).toEqual({
      kind: "unknown",
      claimedAt: attempt.at,
    });
  }
});
