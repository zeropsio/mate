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
  sharedBirths,
  type RunToEnd,
} from "@t3tools/client-runtime/data";
import {
  liveZerops,
  membershipInputs,
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
import { sharedBirthPresentation } from "./sharedBirths";

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
      creator: "cu-me",
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
      attemptProject: async (_birthId, send) => send(),
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
  const creatorArrival = (
    nowMs: number,
    services: ReadonlyArray<ZeropsService>,
    presses: HqPresses = {},
  ) => {
    const candidate = deriveZeropsCandidates(project, services, new Map())[0]!;
    return mateArrival({
      candidate,
      press: undefined,
      nowMs,
      // The legacy arrival path belongs to the tab that made this project.
      created: true,
      madeAt: START,
      pressElsewhere: pressElsewhere({
        presses,
        projectId: project.id,
        importStatus: presses[project.id]?.importProcessId === undefined ? undefined : "RUNNING",
      }),
    });
  };
  // A different account sees HQ's birth, without the creator's press or operations.
  const observer = makeAccountStore(registry);
  liveZerops({ running: [], projects: [project], services: [] }).forEach(observer.dispatch);
  membershipInputs("OWNER").forEach(observer.dispatch);
  const publishBirth = (importProcessId?: string) =>
    seedHqNavigation(observer, ORG, {
      structure: {
        apps: [
          {
            id: "app-franta",
            name: "Franta",
            projects: [
              {
                projectId: project.id,
                name: project.name,
                kind: "mate",
                mate: { face: "", birthId: held.ask.birthId },
              },
            ],
            births: [
              {
                id: held.ask.birthId,
                face: "",
                madeBy: held.ask.creator,
                projectId: project.id,
                ...(importProcessId === undefined ? {} : { importProcessId }),
              },
            ],
          },
        ],
        ungrouped: [],
      },
      presses: {},
    });
  const observedBirth = () =>
    sharedBirths
      .derive(readsOfState(observer.state()), { orgId: ORG, personId: "cu-observer" })
      .open.find((birth) => birth.projectId === project.id)!;
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
    publishBirth();
    expect(observedBirth()).toMatchObject({
      projectId: project.id,
      progress: { phase: "project-created", next: { kind: "wait", for: "creation-history" } },
    });
    expect(sharedBirthPresentation(observedBirth())).toMatchObject({
      line: "Project created · Waiting for project creation history",
      attention: false,
    });
    // Keep the old arrival assertions on the creator path; the fresh observer reads the birth.
    const creator = creatorArrival(nowMs, []);
    expect(creator).toMatchObject({
      coming: { kind: "coming" },
      page: { kind: "coming", coming: { kind: "coming" } },
    });
    expect(mateBornLine(creator.coming!)).toMatchObject({ words: "Coming up", tone: "muted" });
    expect(mateComingHeadlineClauses(mate, creator.coming!.kind)).toEqual([
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
    const later = creatorArrival(nowMs + 15_000, services, {
      [project.id]: { kind: "mate", importProcessId: "import-pepa", held: false },
    });
    expect(later.coming?.kind).toBe("coming");
    imported.resolve({ serviceName: "zcp", imported: true, processId: "import-pepa" });
    expect(await press).toMatchObject({ ok: true, projectId: project.id });
    // HQ retains the accepted import after the creator's press has gone.
    publishBirth("import-pepa");
    const recovered = () =>
      projectCreations.derive(readsOfState(observer.state()), {
        orgId: ORG,
        projectIds: [project.id],
      })[project.id];
    const creatorAfterImport = () =>
      mateArrival({
        candidate: deriveZeropsCandidates(project, [], new Map())[0],
        press: undefined,
        nowMs,
        created: true,
        madeAt: START,
        pressElsewhere: pressElsewhere({
          presses: {},
          projectId: project.id,
          importStatus: recovered()?.status,
        }),
      });
    expect(recovered()).toBeUndefined();
    expect(observedBirth()).toMatchObject({
      importProcessId: "import-pepa",
      progress: { phase: "import-accepted", next: { kind: "wait", for: "service" } },
    });
    expect(sharedBirthPresentation(observedBirth())).toMatchObject({
      line: "Import accepted · The Mate service has not appeared in Zerops",
      attention: false,
      actions: ["delete"],
    });
    expect(creatorAfterImport().page?.kind).toBe("coming");
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
      expect(observedBirth().progress).toMatchObject({
        phase: "import-accepted",
        next: { kind: "wait", for: "service" },
      });
      expect(sharedBirthPresentation(observedBirth())).toMatchObject({
        line: "Import accepted · The Mate service has not appeared in Zerops",
        attention: false,
        actions: ["delete"],
      });
      expect(creatorAfterImport().page?.kind).toBe("coming");
    }
    expect(observer.state().operations.size).toBe(0);
    expect(importCalls).toHaveLength(1);
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
    observer.close();
    registry.dispose();
  }
});
