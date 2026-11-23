import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { makeAccountStore } from "../store.ts";
import {
  birthDeletesOf,
  birthProgressOf,
  sharedBirths,
  type BirthEvidence,
} from "./birthProgress.ts";
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
// witness: packages/client-runtime/src/data/projections/birthProgress.ts | birth.operation.failure === undefined → birth.operation.continueBy === undefined
it("PJ133: Delete of an open birth removes the birth alone while it is unbound or adopted, and its project while a bound birth is not running (ended with a failure, waiting for its maker, or without an operation), and nothing while a bound birth runs; breaks: a Mate whose setup failed or whose maker never continues it can never be removed, or a running birth's project is deleted under it", () => {
  const accepted = { kind: "birth", phase: "accepted", acceptedAt, at: acceptedAt } as const;
  const failed = {
    ...accepted,
    phase: "import_accepted",
    at: failedAt,
    failure: { step: "import", code: "build_failed", at: failedAt, origin: "zerops_process" },
  } as const;
  const waiting = {
    ...failed,
    failure: { ...failed.failure, code: "token_expired", origin: "hq" },
    continueBy: "ada",
  };
  const allowed = { addMate: true, editRecord: true, projectGoing: false };
  const unbound = { operation: accepted };
  const adopted = { projectId: "p1", adopted: true, operation: accepted };
  const bound = { projectId: "p1", operation: failed };
  const examples = [
    { birth: unbound, person: allowed, answer: "birth" },
    { birth: unbound, person: { ...allowed, addMate: false }, answer: null },
    { birth: adopted, person: allowed, answer: "birth" },
    { birth: adopted, person: { ...allowed, addMate: false }, answer: null },
    { birth: bound, person: allowed, answer: "project" },
    { birth: bound, person: { ...allowed, editRecord: false }, answer: null },
    { birth: { ...bound, operation: accepted }, person: allowed, answer: null },
    { birth: { ...bound, operation: waiting }, person: allowed, answer: "project" },
    {
      birth: { ...bound, operation: waiting },
      person: { ...allowed, editRecord: false },
      answer: null,
    },
    { birth: { projectId: "p1" }, person: allowed, answer: "project" },
    { birth: bound, person: { ...allowed, projectGoing: true }, answer: null },
  ];
  expect(examples.map(({ birth, person }) => birthDeletesOf(birth, person))).toEqual(
    examples.map(({ answer }) => answer),
  );
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | offer.edit.kind === "allowed" → offer.edit.kind !== "unknown"
it("PJ134: A bound birth HQ ended with a failure offers Delete of its project only to a person HQ offers its Mate's record; breaks: a Read only person is offered a Delete HQ refuses", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({
    running: [],
    projects: [{ id: "p1", name: "Shop - Ada" }],
    services: [],
  }).forEach(store.dispatch);
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
          births: [
            {
              ...initial.birth,
              projectId: "p1",
              operation: {
                kind: "birth",
                phase: "import_accepted",
                acceptedAt,
                at: failedAt,
                failure: {
                  step: "import",
                  code: "build_failed",
                  at: failedAt,
                  origin: "zerops_process",
                },
              },
            },
          ],
        },
      ],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  expect(registry.get(read).open).toMatchObject([{ deletes: null }]);
  membershipInputs("ADMIN", false, 2).forEach(store.dispatch);
  expect(registry.get(read).open).toMatchObject([{ deletes: "project" }]);
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
  expect(registry.get(read).open).toMatchObject([{ id: "birth", adopted: true, deletes: "birth" }]);
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
    failure: { step: "key", code: "token_expired", at, origin: "hq" },
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
        failure: { step: "key", code: "token_expired", at: failedAt, origin: "hq" },
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
it("PJ123: A birth operation waiting for its maker reads as theirs to continue, and as waiting for its maker to everyone else; breaks: the maker sees a blocked Mate with Delete as the only way out after their sign-in ran out", () => {
  const waiting = {
    ...initial,
    birth: {
      ...initial.birth,
      operation: {
        kind: "birth" as const,
        phase: "import_requested" as const,
        acceptedAt,
        at: failedAt,
        failure: {
          step: "import" as const,
          code: "token_expired",
          at: failedAt,
          origin: "hq",
        },
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
  const actions = () => registry.get(read).open.map(({ deletes }) => deletes);
  expect(actions()).toEqual(["birth"]);
  membershipInputs("READ_ONLY", false, 2).forEach(store.dispatch);
  expect(actions()).toEqual([null]);
  membershipInputs("OWNER", false, 3).forEach(store.dispatch);
  expect(actions()).toEqual(["birth"]);
  store.dispatch({
    kind: "stream",
    key: `zerops:${ORG}:organization-user:${ORG}`,
    now: 4,
    event: { kind: "fault", fault: { outcome: "transient", message: "disconnected" }, jitter: 0 },
  });
  expect(actions()).toEqual([null]);
  stop();
  store.close();
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | next: { kind: "unknown" }, → next: { kind: "continue" },
it("PJ124: An unbound birth without an operation reads unknown and offers only Delete; breaks: a birth left from before the cutover offers a Continue nothing can run", () => {
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
    registry.get(read).open.map(({ progress, deletes, startedAt }) => ({
      progress,
      deletes,
      startedAt,
    })),
  ).toEqual([
    {
      progress: { phase: "creating-project", next: { kind: "unknown" }, reason: null },
      deletes: "birth",
      startedAt: undefined,
    },
  ]);
  stop();
  store.close();
  registry.dispose();
});
