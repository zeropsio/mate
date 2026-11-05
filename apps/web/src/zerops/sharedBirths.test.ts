import { describe, expect, it } from "vite-plus/test";
import {
  makeAccountStore,
  runningScope,
  servicesScope,
  sharedBirths,
  type SharedBirth,
  type SharedBirthState,
} from "@t3tools/client-runtime/data";
import {
  liveZerops,
  membershipInputs,
  ORG,
  seedHqNavigation,
  zeropsVersion,
} from "@t3tools/client-runtime/data/fixtures";
import { Atom, AtomRegistry } from "effect/reactivity";
import { placedSharedBirths, sharedBirthPresentation, waitForBirthPlacement } from "./sharedBirths";

const birth: SharedBirth = {
  id: "b1",
  appId: "a1",
  appName: "Shop",
  face: "",
  projectId: null,
  importProcessId: null,
  placement: "unknown",
  intent: {
    projectName: "Shop - Ada",
    recipe: { kind: "none" },
    agents: [],
    standUp: false,
    automated: false,
    placement: { role: "dev", name: "Ada", chief: false },
    location: null,
    userRoles: [],
  },
  progress: { phase: "creating-project", next: { kind: "unknown" }, reason: null },
  canContinue: false,
  canDelete: true,
};

describe("shared births in the group tree", () => {
  it("another authorized person can find an unregistered Chief birth", () => {
    const chief: SharedBirth = {
      ...birth,
      madeBy: "ada",
      chief: true,
      chiefRegistered: false,
      intent: { ...birth.intent!, placement: { ...birth.intent!.placement, chief: true } },
      canContinue: true,
      progress: { phase: "project-created", next: { kind: "register-chief" }, reason: null },
    };
    expect(placedSharedBirths([chief], [], "bea")).toMatchObject([
      { intent: "b1", placement: { groupId: "a1", displayName: "Ada" } },
    ]);
    expect(placedSharedBirths([chief], [], "ada")).toEqual([]);
    expect(placedSharedBirths([{ ...chief, chiefRegistered: true }], [], "bea")).toEqual([]);
  });

  it('Decision: A birth that stopped (closed window, refused request, failed import, container never up, no hello yet) shows the last proven phase and, where known, the Zerops reason, and offers exactly two actions, Continue and Delete; it never renders as an ordinary unreachable Mate and never as "Coming up" for a Mate that is already linked.', () => {
    expect(sharedBirthPresentation(birth)).toMatchObject({
      line: "Creating project · Outcome unknown — waiting for Zerops",
      actions: ["delete"],
    });
    expect(
      sharedBirthPresentation({
        ...birth,
        progress: { phase: "project-created", next: { kind: "import" }, reason: "Quota reached." },
        canContinue: true,
      }),
    ).toMatchObject({ line: "Project created · Quota reached.", actions: ["continue", "delete"] });
    expect(
      sharedBirthPresentation({
        ...birth,
        progress: { phase: "import-accepted", next: { kind: "blocked" }, reason: "No capacity." },
      }),
    ).toMatchObject({ line: "Import accepted · No capacity.", actions: ["delete"] });
    expect(
      sharedBirthPresentation({
        ...birth,
        progress: {
          phase: "container-starting",
          next: { kind: "wait", for: "hello", attach: false },
          reason: null,
        },
        canContinue: true,
      }),
    ).toMatchObject({
      line: "Container starting · Waiting for the Mate to link",
      actions: ["continue", "delete"],
    });
  });

  it("a stopped birth tells a person without Continue who can finish its remaining steps", () => {
    const stopped = {
      ...birth,
      progress: { phase: "creating-project", next: { kind: "create" }, reason: "No capacity." },
    } as const;
    expect(sharedBirthPresentation({ ...stopped, continuePermission: "maker" }).line).toContain(
      "The person who started this setup can continue if they can add Mates and attach the project.",
    );
    expect(sharedBirthPresentation({ ...stopped, continuePermission: "attach" }).line).toContain(
      "Someone who can add Mates and attach this project can continue.",
    );
    expect(sharedBirthPresentation({ ...stopped, continuePermission: "add-mate" }).line).toContain(
      "Someone who can add Mates to this application can continue.",
    );
  });

  it("an interrupted setup names the remaining attachment while the accepted import awaits its service", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], projects: [{ id: "p1", name: "Shop - Ada" }], services: [] }).forEach(
      store.dispatch,
    );
    membershipInputs("OWNER").forEach(store.dispatch);
    const openBirth = {
      id: "b1",
      face: "",
      madeBy: "ada",
      intent: birth.intent!,
      attempts: {},
      projectId: "p1",
      importProcessId: "i1",
    };
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [{ id: "a1", name: "Shop", projects: [], births: [openBirth] }],
        ungrouped: [],
      },
      presses: { p1: { kind: "mate", appId: "a1", held: false } },
    });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(sharedBirthPresentation(registry.get(read).open[0]!)).toMatchObject({
      line: "Import accepted · Setup session ended · The Mate service has not appeared in Zerops · Continue will attach the Mate.",
      attention: true,
      actions: ["continue", "delete"],
    });

    const scope = servicesScope(ORG);
    store.dispatch({
      kind: "membership",
      scope,
      generation: 1,
      delta: { add: ["s1"], remove: [] },
    });
    store.dispatch({
      kind: "rows",
      scope,
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "service",
          id: "s1",
          value: {
            id: "s1",
            projectId: "p1",
            name: "zcp",
            status: "ACTIVE",
            serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
          },
          revision: zeropsVersion(2),
        },
      ],
    });
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "a1",
            name: "Shop",
            projects: [
              {
                projectId: "p1",
                name: "Shop - Ada",
                kind: "mate",
                mate: { face: "", birthId: "b1" },
              },
            ],
            births: [openBirth],
          },
        ],
        ungrouped: [],
      },
      presses: { p1: { kind: "mate", appId: "a1", held: true } },
    });
    expect(sharedBirthPresentation(registry.get(read).open[0]!)).toMatchObject({
      line: "Container starting · Waiting for the Mate to link",
      actions: ["delete"],
    });
    stop();
    store.close();
    registry.dispose();
  });

  it("a refused import shows the refusal and the exact remaining import step", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [{ id: "create", projectId: "p1", actionName: "project.create" }],
      projects: [{ id: "p1", name: "Shop - Ada" }],
      services: [],
    }).forEach(store.dispatch);
    membershipInputs("OWNER").forEach(store.dispatch);
    store.dispatch({
      kind: "rows",
      scope: runningScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "process",
          id: "create",
          value: {
            id: "create",
            projectId: "p1",
            actionName: "project.create",
            status: "FINISHED",
            serviceStackIds: [],
            created: "2026-11-05T10:00:00Z",
          },
          revision: zeropsVersion(2),
        },
      ],
    });
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "a1",
            name: "Shop",
            projects: [
              {
                projectId: "p1",
                name: "Shop - Ada",
                kind: "mate",
                mate: { face: "", birthId: "b1" },
              },
            ],
            births: [
              {
                id: "b1",
                face: "",
                madeBy: "ada",
                intent: birth.intent!,
                projectId: "p1",
                attempts: {
                  import: {
                    by: "ada",
                    at: "2026-11-05T10:00:00Z",
                    refused: { at: "2026-11-05T10:00:01Z", reason: "Quota reached." },
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
    expect(sharedBirthPresentation(registry.get(read).open[0]!)).toMatchObject({
      line: "Project created · Quota reached. · Continue will submit the import.",
      actions: ["continue", "delete"],
    });
    stop();
    store.close();
    registry.dispose();
  });

  it("several Mate services are called out instead of described as missing", () => {
    expect(
      sharedBirthPresentation({
        ...birth,
        projectId: "p1",
        placement: "attached",
        importProcessId: "i1",
        progress: {
          phase: "import-accepted",
          next: { kind: "wait", for: "several-services", attach: false },
          reason: null,
        },
      }),
    ).toMatchObject({
      line: "Import accepted · Several Mate services are present in the project",
      attention: true,
      actions: ["delete"],
    });
  });

  it("an accepted import with no reported failure reason still says why it cannot continue", () => {
    expect(
      sharedBirthPresentation({
        ...birth,
        projectId: "p1",
        placement: "attached",
        importProcessId: "i1",
        progress: { phase: "import-accepted", next: { kind: "blocked" }, reason: null },
      }),
    ).toMatchObject({
      line: "Import accepted · Zerops reported that the step failed or was canceled",
      attention: true,
      actions: ["delete"],
    });
  });
  it("keeps one durable row as HQ binds a project, even when this tab has local creation state", () => {
    const local = [
      {
        intent: "b1",
        projectId: "b1",
        startedAt: 123,
        placement: { groupId: "a1", groupName: "Shop", kind: "mate" as const, displayName: "Ada" },
      },
    ];
    expect(placedSharedBirths([birth], local)).toEqual([
      {
        intent: "b1",
        projectId: "b1",
        placement: { groupId: "a1", groupName: "Shop", kind: "mate", displayName: "Ada" },
      },
    ]);
    expect(
      placedSharedBirths(
        [{ ...birth, projectId: "p1" }],
        [...local, { ...local[0]!, projectId: "p1" }],
      ),
    ).toEqual([
      {
        intent: "b1",
        projectId: "p1",
        placement: { groupId: "a1", groupName: "Shop", kind: "mate", displayName: "Ada" },
      },
    ]);
  });
});

it("waits for a birth's binding from the shared source and stops when authority is lost", async () => {
  const registry = AtomRegistry.make();
  const first = {
    ...birth,
    canContinue: true,
    progress: {
      phase: "creating-project" as const,
      next: { kind: "bind" as const, projectId: "p1" },
      reason: null,
    },
  };
  const source = Atom.make<SharedBirthState>({ open: [first], readyProjectIds: [] });
  const options = {
    birthId: "b1",
    projectId: "p1",
    placement: "bound" as const,
    active: () => true,
  };
  const waiting = waitForBirthPlacement(registry, source, options);
  const bound = { ...first, projectId: "p1", placement: "unplaced" as const };
  registry.set(source, { open: [bound], readyProjectIds: [] });
  expect(await waiting).toEqual(bound);

  const attaching = waitForBirthPlacement(registry, source, { ...options, placement: "attached" });
  registry.set(source, { open: [{ ...bound, canContinue: false }], readyProjectIds: [] });
  expect(await attaching).toBeUndefined();
  registry.dispose();
});
