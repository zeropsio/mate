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
