import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
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
  birth: { id: "birth", face: "rose:seal", madeBy: "ada", intent: plan },
  viewer: "ada",
  service: null,
};
const failedAt = "2026-11-05T10:00:00.000Z";
const acceptedAt = "2026-11-19T10:00:00.000Z";
// witness: packages/client-runtime/src/data/projections/birthProgress.ts | )?.allow === true, → )?.allow !== true,
it("PJ58: A bound birth offers Delete only to a project administrator", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [{ id: "p1", name: "Shop - Ada" }], services: [] }).forEach(
    store.dispatch,
  );
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
  expect(registry.get(read).open).toMatchObject([{ canDelete: false }]);
  membershipInputs("ADMIN", false, 2).forEach(store.dispatch);
  expect(registry.get(read).open).toMatchObject([{ canDelete: true }]);
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
        operation: { kind: "birth", phase: "import_accepted", acceptedAt, at: acceptedAt },
      },
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

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | : continueBy === evidence.viewer → : birth.madeBy === evidence.viewer
it("PJ93: A birth's operation offers Continue only to the person HQ names to continue it, whatever presses its project shows", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({
    running: [],
    projects: [{ id: "p1", name: plan.projectName }],
    services: [],
  }).forEach(store.dispatch);
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
            births: [{ ...initial.birth, projectId: "p1", operation }],
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
    expect(birth?.progress).toEqual({
      phase: "project-created",
      next: { kind: "wait", for: "hq" },
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
  expect(births().map((birth) => birth?.progress.next.kind === "continue")).toEqual([
    false,
    true,
    false,
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
        at: failedAt,
        failure: { step: "key", code: "token_expired", at: failedAt },
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

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | : { kind: "wait", for: "maker" }, → : { kind: "blocked" },
it("PJ+1: A birth operation waiting for its maker reads as theirs to continue, and as waiting for its maker to everyone else; breaks: the maker sees a blocked Mate with Delete as the only way out after their sign-in ran out", () => {
  const waiting = {
    ...initial,
    birth: {
      ...initial.birth,
      operation: {
        kind: "birth" as const,
        phase: "import_requested" as const,
        acceptedAt,
        at: failedAt,
        failure: { step: "import" as const, code: "token_expired", at: failedAt },
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
      next: { kind: "wait", for: "maker" },
      reason: "token_expired",
      failedStep: "import",
    },
  ]);
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | const roleLive = membership.kind === "known" && read.stream(membership.scope).phase === "live"; → const roleLive = membership.kind === "known";
it("PJ96: A birth offers Delete only while its person's role is read live and allows it", () => {
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
  const actions = () => registry.get(read).open.map(({ canDelete }) => canDelete);
  expect(actions()).toEqual([true]);
  membershipInputs("READ_ONLY", false, 2).forEach(store.dispatch);
  expect(actions()).toEqual([false]);
  membershipInputs("OWNER", false, 3).forEach(store.dispatch);
  expect(actions()).toEqual([true]);
  store.dispatch({
    kind: "stream",
    key: `zerops:${ORG}:organization-user:${ORG}`,
    now: 4,
    event: { kind: "fault", fault: { outcome: "transient", message: "disconnected" }, jitter: 0 },
  });
  expect(actions()).toEqual([false]);
  stop();
  store.close();
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | next: { kind: "unknown" }, → next: { kind: "continue" },
it("PJ+2: A birth without an operation reads unknown and offers only Delete; breaks: a birth left from before the cutover offers a Continue nothing can run", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [], services: [] }).forEach(store.dispatch);
  membershipInputs("OWNER").forEach(store.dispatch);
  // Left from before the cutover: HQ holds no operation for it.
  const left = initial.birth;
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [{ id: "app", name: "Shop", projects: [], births: [left] }],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  expect(
    registry.get(read).open.map(({ progress, canDelete, startedAt }) => ({
      progress,
      canDelete,
      startedAt,
    })),
  ).toEqual([
    {
      progress: { phase: "creating-project", next: { kind: "unknown" }, reason: null },
      canDelete: true,
      startedAt: undefined,
    },
  ]);
  stop();
  store.close();
  registry.dispose();
});
