import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";

import {
  liveZerops,
  ORG,
  processValue,
  projectValue,
  zeropsVersion,
} from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { hqPressesScope } from "../families/hqNavigation.ts";
import { historyScope } from "../families/process.ts";
import { projectsScope } from "../families/project.ts";
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

describe("shared birth progress", () => {
  it("an attached birth becomes ready only when HQ removes the open birth after hello", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], projects: [{ id: "p1", name: "Shop - Ada" }], services: [] }).forEach(
      store.dispatch,
    );
    membershipInputs("OWNER").forEach(store.dispatch);
    const project = {
      projectId: "p1",
      name: "Shop - Ada",
      kind: "mate",
      mate: { face: "rose:seal", birthId: "birth" },
    };
    const structure = (births: (typeof initial.birth)[]) => ({
      apps: [{ id: "app", name: "Shop", projects: [project], births }],
      ungrouped: [],
    });
    seedHqNavigation(store, ORG, { structure: structure([{ ...initial.birth, projectId: "p1" }]) });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(registry.get(read)).toMatchObject({ open: [{ id: "birth" }], readyProjectIds: [] });
    seedHqNavigation(store, ORG, { structure: structure([]) });
    expect(registry.get(read)).toMatchObject({ open: [], readyProjectIds: ["p1"] });
    stop();
    store.close();
    registry.dispose();
  });

  it("a bound birth offers Delete only to a project administrator", () => {
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

  it("a project owner can delete a bound birth without permission to create projects", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      projects: [
        {
          id: "p1",
          name: "Shop - Ada",
          userRoles: [{ clientUserId: "member", roleCode: "OWNER" }],
        },
      ],
      services: [],
    }).forEach(store.dispatch);
    creationFinished(store);
    membershipInputs("BASIC_USER", false).forEach(store.dispatch);
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "app",
            name: "Shop",
            projects: [],
            births: [{ ...initial.birth, projectId: "p1" }],
          },
        ],
        ungrouped: [],
      },
    });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(registry.get(read).open).toMatchObject([{ canContinue: false, canDelete: true }]);
    store.dispatch({
      kind: "rows",
      scope: projectsScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "project",
          id: "p1",
          value: projectValue({ id: "p1", name: "Shop - Ada", userRoles: [] }),
          revision: zeropsVersion(2),
        },
      ],
    });
    expect(registry.get(read).open).toMatchObject([{ canContinue: false, canDelete: false }]);
    stop();
    store.close();
    registry.dispose();
  });

  it("a bound birth before attachment offers Continue only to someone who can attach it", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], projects: [{ id: "p1", name: "Shop - Ada" }], services: [] }).forEach(
      store.dispatch,
    );
    creationFinished(store);
    membershipInputs("READ_ONLY", true).forEach(store.dispatch);
    const birth = { ...initial.birth, projectId: "p1" };
    const structure = (attached: boolean) => ({
      apps: [
        {
          id: "app",
          name: "Shop",
          projects: attached
            ? [
                {
                  projectId: "p1",
                  name: "Shop - Ada",
                  kind: "mate",
                  mate: { face: "rose:seal", birthId: "birth" },
                },
              ]
            : [],
          births: [birth],
        },
      ],
      ungrouped: [],
    });
    seedHqNavigation(store, ORG, { structure: structure(false) });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(registry.get(read).open).toMatchObject([{ placement: "unplaced", canContinue: false }]);
    membershipInputs("ADMIN", false, 2).forEach(store.dispatch);
    expect(registry.get(read).open).toMatchObject([{ placement: "unplaced", canContinue: true }]);
    membershipInputs("READ_ONLY", true, 3).forEach(store.dispatch);
    seedHqNavigation(store, ORG, { structure: structure(true) });
    expect(registry.get(read).open).toMatchObject([{ placement: "attached", canContinue: true }]);
    stop();
    store.close();
    registry.dispose();
  });

  it("a bound birth distinguishes an unplaced project from its own attached Mate", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], projects: [{ id: "p1", name: "Shop - Ada" }], services: [] }).forEach(
      store.dispatch,
    );
    membershipInputs("OWNER").forEach(store.dispatch);
    const birth = { ...initial.birth, projectId: "p1" };
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [{ id: "app", name: "Shop", projects: [], births: [birth] }],
        ungrouped: [],
      },
    });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(registry.get(read).open).toMatchObject([{ placement: "unplaced" }]);
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
            births: [birth],
          },
        ],
        ungrouped: [],
      },
    });
    expect(registry.get(read).open).toMatchObject([{ placement: "attached" }]);
    stop();
    store.close();
    registry.dispose();
  });

  it("birth actions follow role loss, re-grant, and a membership read that stops being live", () => {
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
    const maker = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const other = store.data.project(sharedBirths, { orgId: ORG, personId: "other" });
    const stopMaker = registry.subscribe(maker, () => registry.get(maker), { immediate: true });
    const stopOther = registry.subscribe(other, () => registry.get(other), { immediate: true });
    expect(registry.get(maker).open).toMatchObject([{ canContinue: true, canDelete: true }]);
    expect(registry.get(other).open).toMatchObject([{ canContinue: false, canDelete: true }]);
    membershipInputs("READ_ONLY", false, 2).forEach(store.dispatch);
    expect(registry.get(maker).open).toMatchObject([{ canContinue: false, canDelete: false }]);
    membershipInputs("OWNER", false, 3).forEach(store.dispatch);
    expect(registry.get(maker).open).toMatchObject([{ canContinue: true, canDelete: true }]);
    store.dispatch({
      kind: "stream",
      key: `zerops:${ORG}:organization-user:${ORG}`,
      now: 4,
      event: { kind: "fault", fault: { outcome: "transient", message: "disconnected" }, jitter: 0 },
    });
    expect(registry.get(maker).open).toMatchObject([{ canContinue: false, canDelete: false }]);
    stopMaker();
    stopOther();
    store.close();
    registry.dispose();
  });

  it("a birth and its matching project arriving after first paint update the account projection", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], projects: [], services: [] }).forEach(store.dispatch);
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    seedHqNavigation(store, ORG, {
      structure: { apps: [{ id: "app", name: "Shop", projects: [], births: [] }], ungrouped: [] },
    });
    expect(registry.get(read).open).toEqual([]);
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "app",
            name: "Shop",
            projects: [],
            births: [{ ...initial.birth, attempts: { create: attempt } }],
          },
        ],
        ungrouped: [],
      },
    });
    expect(registry.get(read).open).toMatchObject([
      { id: "birth", progress: { next: { kind: "unknown" } } },
    ]);
    store.dispatch({
      kind: "membership",
      scope: projectsScope(ORG),
      generation: 1,
      delta: { add: ["p1"], remove: [] },
    });
    store.dispatch({
      kind: "rows",
      scope: projectsScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "project",
          id: "p1",
          value: projectValue({ id: "p1", name: "Shop - Ada" }),
          revision: zeropsVersion(1),
        },
      ],
    });
    expect(registry.get(read).open).toMatchObject([
      { id: "birth", progress: { next: { kind: "bind", projectId: "p1" } } },
    ]);
    stop();
    store.close();
    registry.dispose();
  });

  it("Decision: The person sees the progress live — creating project → project created → import accepted → container starting → Mate linked, ready — each step from the real event that proves it (HQ birth record + the person's Zerops stream through the client data layer), on every device that is authorized, never from a timer, a local step counter or a component-local copy.", () => {
    expect(birthProgressOf(initial)).toMatchObject({
      phase: "creating-project",
      next: { kind: "create" },
    });
    const project = {
      ...initial,
      birth: { ...initial.birth, projectId: "p1", attempts: { create: attempt } },
      projects: [{ id: "p1", name: "Shop - Ada" }],
    };
    expect(birthProgressOf(project)).toMatchObject({
      phase: "project-created",
      next: { kind: "import" },
    });
    const imported = { ...project, birth: { ...project.birth, importProcessId: "i1" } };
    expect(birthProgressOf(imported)).toMatchObject({
      phase: "import-accepted",
      next: { kind: "wait" },
    });
    expect(birthProgressOf({ ...imported, service: { id: "s1", status: "ACTIVE" } })).toMatchObject(
      {
        phase: "container-starting",
        next: { kind: "wait" },
      },
    );
  });

  it("an accepted import without a Mate service says what is awaited without re-importing", () => {
    const imported = {
      ...initial,
      birth: { ...initial.birth, projectId: "p1", importProcessId: "i1" },
      projects: [{ id: "p1", name: "Shop - Ada" }],
    };
    expect(birthProgressOf({ ...imported, service: undefined })).toMatchObject({
      phase: "import-accepted",
      next: { kind: "wait", for: "service-observation" },
    });
    expect(birthProgressOf(imported)).toMatchObject({
      phase: "import-accepted",
      next: { kind: "wait", for: "service", attach: false },
    });
    expect(birthProgressOf({ ...imported, placement: "unplaced" })).toMatchObject({
      next: { kind: "wait", for: "service", attach: true },
    });
    expect(
      birthProgressOf({ ...imported, service: { id: "s1", status: "BUILDING" } }),
    ).toMatchObject({
      phase: "container-starting",
      next: { kind: "wait", for: "container" },
    });
    expect(birthProgressOf({ ...imported, service: { id: "s1", status: "ACTIVE" } })).toMatchObject(
      {
        phase: "container-starting",
        next: { kind: "wait", for: "hello" },
      },
    );
  });

  it("an attached running Mate awaits hello without offering a Continue that does nothing", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      projects: [{ id: "p1", name: "Shop - Ada" }],
      services: [
        {
          id: "s1",
          projectId: "p1",
          status: "ACTIVE",
          serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
        },
      ],
    }).forEach(store.dispatch);
    membershipInputs("OWNER").forEach(store.dispatch);
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
            births: [{ ...initial.birth, projectId: "p1", importProcessId: "i1" }],
          },
        ],
        ungrouped: [],
      },
    });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(registry.get(read).open).toMatchObject([
      {
        placement: "attached",
        canContinue: false,
        progress: { next: { kind: "wait", for: "hello" } },
      },
    ]);
    stop();
    store.close();
    registry.dispose();
  });

  it("a stopped setup session is shown only while the matching HQ press is live", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], projects: [{ id: "p1", name: "Shop - Ada" }], services: [] }).forEach(
      store.dispatch,
    );
    membershipInputs("OWNER").forEach(store.dispatch);
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "app",
            name: "Shop",
            projects: [],
            births: [{ ...initial.birth, projectId: "p1", importProcessId: "i1" }],
          },
        ],
        ungrouped: [],
      },
      presses: { p1: { kind: "mate", appId: "app", held: false } },
    });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(registry.get(read).open[0]?.progress.sessionEnded).toBe(true);
    store.dispatch({
      kind: "stream",
      key: hqPressesScope(ORG),
      now: 0,
      event: { kind: "fault", fault: { outcome: "transient", message: "disconnected" }, jitter: 0 },
    });
    expect(registry.get(read).open[0]?.progress.sessionEnded).toBeUndefined();
    stop();
    store.close();
    registry.dispose();
  });

  it("several Mate services are not mistaken for an absent service", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      projects: [{ id: "p1", name: "Shop - Ada" }],
      services: ["s1", "s2"].map((id) => ({
        id,
        projectId: "p1",
        status: "ACTIVE",
        serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
      })),
    }).forEach(store.dispatch);
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "app",
            name: "Shop",
            projects: [],
            births: [{ ...initial.birth, projectId: "p1", importProcessId: "i1" }],
          },
        ],
        ungrouped: [],
      },
    });
    const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
    const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
    expect(registry.get(read).open[0]?.progress).toMatchObject({
      next: { kind: "wait", for: "several-services" },
    });
    stop();
    store.close();
    registry.dispose();
  });

  it("a lost project answer advances only when exactly one unheld project of the original name arrives", () => {
    const lost = { ...initial, birth: { ...initial.birth, attempts: { create: attempt } } };
    expect(birthProgressOf(lost).next).toEqual({ kind: "unknown" });
    const arrived = { ...lost, projects: [{ id: "p1", name: "Shop - Ada" }] };
    expect(birthProgressOf(arrived).next).toEqual({ kind: "bind", projectId: "p1" });
    expect(birthProgressOf({ ...arrived, heldProjects: new Set(["p1"]) }).next).toEqual({
      kind: "unknown",
    });
    expect(birthProgressOf({ ...arrived, projectsCurrent: false }).next).toEqual({
      kind: "unknown",
    });
    expect(
      birthProgressOf({
        ...arrived,
        projects: [...arrived.projects, { id: "p2", name: "Shop - Ada" }],
      }).next,
    ).toEqual({ kind: "unknown" });
  });

  it("only a refusal newer than the current claim frees that step", () => {
    const withRefusal = (at: string) => ({
      ...initial,
      birth: {
        ...initial.birth,
        attempts: { create: { ...attempt, refused: { at, reason: "Quota reached." } } },
      },
    });
    expect(birthProgressOf(withRefusal("2026-11-05T10:00:01.000Z"))).toMatchObject({
      next: { kind: "create" },
      reason: "Quota reached.",
    });
    expect(birthProgressOf(withRefusal("2026-11-05T09:59:59.000Z")).next).toEqual({
      kind: "unknown",
    });
    expect(
      birthProgressOf({ ...initial, birth: { id: "birth", face: "", madeBy: "ada", intent: plan } })
        .next,
    ).toEqual({ kind: "unknown" });
  });

  it("a proven unsent attempt permits a new claim but an older outcome cannot free a newer claim", () => {
    const unsent = (at: string) => ({
      ...initial,
      birth: {
        ...initial.birth,
        attempts: { create: { ...attempt, unsent: { at, reason: "Key unavailable." } } },
      },
    });
    expect(birthProgressOf(unsent("2026-11-05T10:00:01.000Z"))).toMatchObject({
      next: { kind: "create" },
      reason: "Key unavailable.",
    });
    expect(birthProgressOf(unsent("2026-11-05T09:59:59.000Z")).next).toEqual({ kind: "unknown" });
  });

  it("an accepted import failure blocks another import and retains the platform reason", () => {
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

  it("a listed project whose creation still runs waits for its actual outcome before importing", () => {
    const project = {
      ...initial,
      birth: { ...initial.birth, projectId: "p1", attempts: { create: attempt } },
      projects: [{ id: "p1", name: "Shop - Ada" }],
      createProcess: processValue({
        id: "create",
        projectId: "p1",
        actionName: "project.create",
        status: "RUNNING",
      }),
    };
    expect(birthProgressOf(project)).toMatchObject({
      phase: "project-created",
      next: { kind: "wait" },
    });
    expect(
      birthProgressOf({
        ...project,
        createProcess: { ...project.createProcess, status: "FAILED", failReason: "No capacity." },
      }),
    ).toMatchObject({ next: { kind: "blocked" }, reason: "No capacity." });
    expect(
      birthProgressOf({
        ...project,
        createProcess: { ...project.createProcess, status: "FINISHED" },
      }),
    ).toMatchObject({ next: { kind: "import" } });
  });

  it("a bound project waits for its first creation-process read before offering an import", () => {
    const project = {
      ...initial,
      birth: { ...initial.birth, projectId: "p1", attempts: { create: attempt } },
      projects: [{ id: "p1", name: "Shop - Ada" }],
      projectHistoryCurrent: false,
    };
    expect(birthProgressOf(project)).toMatchObject({
      phase: "project-created",
      next: { kind: "wait" },
    });
    expect(birthProgressOf({ ...project, projectHistoryCurrent: true })).toMatchObject({
      next: { kind: "import" },
    });
  });

  it("a lost import answer is unknown until a zcp service proves acceptance", () => {
    const lost = {
      ...initial,
      birth: { ...initial.birth, projectId: "p1", attempts: { create: attempt, import: attempt } },
      projects: [{ id: "p1", name: "Shop - Ada" }],
    };
    expect(birthProgressOf(lost).next).toEqual({ kind: "unknown" });
    expect(birthProgressOf({ ...lost, service: { id: "s1", status: "ACTIVE" } })).toMatchObject({
      phase: "container-starting",
      next: { kind: "record-import", receipt: "s1" },
    });
  });

  it("a lost import answer records its uniquely correlated process before the service fallback", () => {
    const lost = {
      ...initial,
      birth: { ...initial.birth, projectId: "p1", attempts: { create: attempt, import: attempt } },
      projects: [{ id: "p1", name: "Shop - Ada" }],
      service: { id: "s1", status: "CONTAINER_FAILED" },
    };
    const failed = processValue({
      id: "i1",
      projectId: "p1",
      actionName: "stack.create",
      serviceStackIds: ["s1"],
      status: "FAILED",
      failReason: "No capacity.",
    });
    expect(birthProgressOf({ ...lost, processes: [failed] }).next).toEqual({
      kind: "record-import",
      receipt: "i1",
    });
    expect(birthProgressOf({ ...lost, processes: [failed, { ...failed, id: "i2" }] }).next).toEqual(
      { kind: "record-import", receipt: "s1" },
    );
    expect(
      birthProgressOf({
        ...lost,
        birth: { ...lost.birth, importProcessId: "s1" },
        processes: [failed],
      }),
    ).toMatchObject({ next: { kind: "blocked" }, reason: "No capacity." });
  });

  it("a failed or stopped container reports its proven state and correlated build reason without reimporting", () => {
    const imported = {
      ...initial,
      birth: { ...initial.birth, projectId: "p1", importProcessId: "i1" },
      projects: [{ id: "p1", name: "Shop - Ada" }],
      service: { id: "s1", status: "CONTAINER_FAILED" },
    };
    expect(birthProgressOf(imported)).toMatchObject({
      phase: "container-starting",
      next: { kind: "wait" },
      reason: "Container failed.",
    });
    expect(
      birthProgressOf({ ...imported, service: { id: "s1", status: "STOPPED" } }),
    ).toMatchObject({ next: { kind: "wait" }, reason: "Container stopped." });
    const failedBuild = processValue({
      id: "build",
      projectId: "p1",
      actionName: "stack.build",
      serviceStackIds: ["s1"],
      status: "FAILED",
      failReason: "Build had no capacity.",
    });
    expect(birthProgressOf({ ...imported, processes: [failedBuild] })).toMatchObject({
      next: { kind: "wait" },
      reason: "Build had no capacity.",
    });
  });
});
