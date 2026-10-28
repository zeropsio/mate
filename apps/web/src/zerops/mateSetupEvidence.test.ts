import {
  creationPressStoreAtom,
  creationSteps,
  projectCreations,
  makeAccountStore,
  makeOperations,
  mateArrival,
  readsOfState,
  runningScope,
  runToEnd,
  type RunToEnd,
} from "@t3tools/client-runtime/data";
import {
  liveZerops,
  ORG,
  seedHqNavigation,
  zeropsVersion,
} from "@t3tools/client-runtime/data/fixtures";
import type { ZeropsProject, ZeropsService } from "@t3tools/client-runtime/zerops";
import { deriveBirthProgress } from "@t3tools/client-runtime/zerops/birthProgress";
import { deriveZeropsCandidates } from "@t3tools/client-runtime/zerops/candidates";
import { pressElsewhere, type HqPresses } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { mateBornLine } from "../components/zerops/SidebarMateRow.logic";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { arrivalRow, arrivalSteps } from "./mateArrival";
import { mateComingHeadlineClauses } from "./mateComing";
import { beginPress, forgetPress, runPress } from "./matePress";
import { runNewProjectBirth, type CreationAsk } from "./newProjectBirth";

const START = Date.parse("2026-10-28T12:29:49.006Z");
const project: ZeropsProject = {
  id: "p-pepa",
  name: "Franta - Pepa",
  status: "ACTIVE",
  created: new Date(START).toISOString(),
};
const mate = { name: "Pepa", project: "Franta" };

it("a fresh observer awaits the original accepted setup beyond 0:42 and advances without another import", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [] }).forEach(store.dispatch);
  appAtomRegistry.set(creationPressStoreAtom, makeAccountStore(appAtomRegistry));
  const sends = vi.fn();
  const operations = makeOperations({
    store,
    makeId: () => "unexpected-unnamed-request",
    executors: {
      zerops: {
        submit: (requestId, intent) => {
          sends(intent);
          return Effect.succeed({
            requestId,
            executor: "zerops" as const,
            operationId: project.id,
            affected: [],
            handles: [project.id],
            acceptance: { kind: "accepted" as const, result: { projectId: project.id } },
            outcome: { kind: "pending" as const },
          });
        },
      },
    },
  });
  const run = runToEnd({ operations, store, registry });
  const accepted = Promise.withResolvers<void>();
  const importing = Promise.withResolvers<void>();
  const imported = Promise.withResolvers<{
    readonly serviceName: string;
    readonly imported: boolean;
    readonly processId: string;
  }>();
  const importCalls: Array<{ readonly projectId: string; readonly projectName: string }> = [];
  const importRun = (async (intent: Parameters<RunToEnd>[0]) => {
    if (intent.kind !== "import-container") throw new Error(`Unexpected ${intent.kind}`);
    importCalls.push({ projectId: intent.projectId, projectName: intent.projectName });
    importing.resolve();
    return imported.promise;
  }) as RunToEnd;
  const held: CreationAsk = {
    ask: {
      organizationId: ORG,
      birthId: "birth-pepa",
      name: "Franta",
      botName: mate.name,
      face: { tint: "rose", shape: "seal" },
      locationId: null,
      agents: [],
    },
    startedAt: START,
    hq: { projectId: "hq", address: "https://hq.test" },
    presses: 1,
    refusedHere: null,
  };
  let press: ReturnType<typeof runPress> | undefined;
  const creation = runNewProjectBirth(
    held,
    () => ({
      ...creationSteps.derive(readsOfState(store.state()), {
        orgId: ORG,
        creationId: held.ask.birthId,
      }),
      appId: "app-franta",
      birthId: "intent-pepa",
      steps: {
        app: { state: "done", attempt: 1 },
        birth: { state: "done", attempt: 1 },
        project: creationSteps.derive(readsOfState(store.state()), {
          orgId: ORG,
          creationId: held.ask.birthId,
        }).steps.project,
      },
    }),
    {
      registerGroup: () => Promise.reject(new Error("Application already recorded")),
      recordBirth: () => Promise.reject(new Error("Birth already recorded")),
      createProject: (requestId, args) =>
        run(
          { kind: "create-project", orgId: ORG, name: args.name, tagList: [] },
          {
            orgId: ORG,
            requestId,
            unobserved: "Awaiting the creation result.",
            accepted: () => accepted.resolve(),
          },
        ),
      accepted: (projectId) => {
        beginPress({
          projectId,
          organizationId: ORG,
          startedAt: START,
          placement: null,
          container: true,
        });
        press = runPress({
          organizationId: ORG,
          steps: [{ kind: "import-container", agents: [] }],
          platform: {
            run: importRun,
            markClosedOff: async () => undefined,
            register: async () => undefined,
            untilServicesSettled: async () => [],
          },
          isCurrent: () => true,
          locks: undefined,
          resume: { from: 0, projectId, projectName: project.name },
        });
      },
    },
  );
  const creationFinished = () =>
    store.dispatch({
      kind: "rows",
      scope: runningScope(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "process",
          id: "create-pepa",
          value: {
            id: "create-pepa",
            projectId: project.id,
            serviceStackIds: [],
            status: "FINISHED",
            actionName: "project.create",
            created: new Date(START).toISOString(),
            started: new Date(START).toISOString(),
            finished: new Date(START + 42_777).toISOString(),
          },
          revision: zeropsVersion(2),
        },
      ],
    });
  const observe = (
    nowMs: number,
    services: ReadonlyArray<ZeropsService>,
    presses: HqPresses = {},
  ) => {
    const candidate = deriveZeropsCandidates(project, services, new Map())[0]!;
    return mateArrival({
      candidate,
      press: undefined,
      nowMs,
      pressElsewhere: pressElsewhere({
        presses,
        projectId: project.id,
        nowMs,
        importStatus: presses[project.id]?.importProcessId === undefined ? undefined : "RUNNING",
      }),
    });
  };
  try {
    await accepted.promise;
    expect(sends).toHaveBeenCalledTimes(1);
    expect(
      creationSteps.derive(readsOfState(store.state()), {
        orgId: ORG,
        creationId: held.ask.birthId,
      }),
    ).toMatchObject({
      projectId: project.id,
      steps: { project: { state: "running" } },
    });
    expect(importCalls).toEqual([]);
    const nowMs = START + 42_777;
    const fresh = observe(nowMs, []);
    expect(fresh).toMatchObject({
      coming: { kind: "coming" },
      page: { kind: "coming", coming: { kind: "coming" } },
    });
    expect(mateBornLine(fresh.coming!)).toMatchObject({ words: "Coming up", tone: "muted" });
    expect(mateComingHeadlineClauses(mate, fresh.coming!.kind)).toEqual([
      "Pepa is coming up on Franta.",
    ]);
    const progress = deriveBirthProgress(
      {
        project: {
          status: "ACTIVE",
          ...(project.created === undefined ? {} : { createdAt: project.created }),
        },
        container: undefined,
        processes: [],
        health: undefined,
        connection: "none",
      },
      nowMs,
    );
    expect(arrivalRow(arrivalSteps(progress, mate, nowMs), progress.steps).state).toBe("running");

    creationFinished();
    await creation;
    await importing.promise;
    expect(importCalls).toEqual([{ projectId: project.id, projectName: project.name }]);
    const services = [
      {
        id: "zcp-pepa",
        name: "zcp",
        status: "CREATING",
        serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
      },
    ];
    const later = observe(nowMs + 15_000, services, {
      [project.id]: { kind: "mate", importProcessId: "import-pepa", expiresAtMs: START },
    });
    expect(later.coming?.kind).toBe("coming");
    imported.resolve({ serviceName: "zcp", imported: true, processId: "import-pepa" });
    expect(await press).toMatchObject({ ok: true, projectId: project.id });
    // The creator has finished. This account has neither its press nor its local operations.
    const observer = makeAccountStore(registry);
    liveZerops({ running: [] }).forEach(observer.dispatch);
    seedHqNavigation(observer, ORG, {
      structure: {
        apps: [],
        ungrouped: [
          {
            projectId: project.id,
            name: mate.name,
            mate: { face: "", importProcessId: "import-pepa" },
          },
        ],
      },
      presses: {},
    });
    const recovered = () =>
      projectCreations.derive(readsOfState(observer.state()), {
        orgId: ORG,
        projectIds: [project.id],
      })[project.id];
    const recoveredArrival = () =>
      mateArrival({
        candidate: deriveZeropsCandidates(project, [], new Map())[0],
        press: undefined,
        nowMs,
        pressElsewhere: pressElsewhere({
          presses: {},
          projectId: project.id,
          nowMs,
          importStatus: recovered()?.status,
        }),
      });
    expect(recovered()).toBeUndefined();
    expect(recoveredArrival().page?.kind).toBe("coming");
    for (const [index, status] of ["RUNNING", "FINISHED"].entries()) {
      observer.dispatch({
        kind: "rows",
        scope: runningScope(ORG),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "process",
            id: "import-pepa",
            revision: zeropsVersion(index + 10),
            value: {
              id: "import-pepa",
              projectId: project.id,
              actionName: "stack.create",
              serviceStackIds: [],
              status,
              created: new Date(START).toISOString(),
            },
          },
        ],
      });
      expect(recovered()).toEqual({ processId: "import-pepa", status, error: null });
      expect(recoveredArrival().page?.kind).toBe("coming");
    }
    expect(observer.state().operations.size).toBe(0);
    expect(importCalls).toHaveLength(1);
    observer.close();
    const up = mateArrival({
      press: undefined,
      candidate: deriveZeropsCandidates(project, services, new Map())[0],
      link: {
        key: `${project.id}:zcp-pepa`,
        environmentId: EnvironmentId.make("pepa"),
        reachability: { kind: "ready", notice: null },
        answered: true,
        failuresSinceConnect: 0,
        errorsSinceConnect: 0,
      },
    });
    expect(up).toMatchObject({ page: { kind: "up" }, coming: undefined });
    expect(importCalls).toHaveLength(1);
    expect(sends).toHaveBeenCalledTimes(1);
  } finally {
    creationFinished();
    imported.resolve({ serviceName: "zcp", imported: true, processId: "import-pepa" });
    await creation;
    await press;
    forgetPress(project.id);
    registry.dispose();
  }
});
