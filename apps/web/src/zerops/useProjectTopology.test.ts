import {
  DEFAULT_ZEROPS_DATA_POLICY,
  createZeropsDataAtoms,
  decodeEntityDirectResponse,
  decodeEntityQueryResponse,
  makeInitialZeropsDataState,
  processRecordToActivityProcess,
  projectKeyOf,
  reduceZeropsDataState,
  type HistoryReadView,
  type ManagedZeropsDataRuntime,
  type ProcessRecord,
  type ProtocolDecodeResult,
  type UsageRead,
  type ZeropsDataReads,
} from "@t3tools/client-runtime/zerops/data";
import type { RegistrationRecord } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentProjectRef,
  projectTopologyAtom,
  zeropsDataRuntimeAtom,
  type EnvironmentProjects,
  type ProjectTopologySnapshot,
} from "../state/zerops";
import {
  desiredInterest,
  directTicket,
  identity,
  organization,
  project,
  scope,
  stamp,
} from "./__fixtures__/platformData";

const owner = project();

/** A data runtime whose state the test pushes facets into, and the registry it lives in. */
function pushedRuntime(overrides: Partial<ZeropsDataReads> = {}) {
  const id = identity();
  const stateAtom = Atom.make(
    reduceZeropsDataState(
      makeInitialZeropsDataState(scope()),
      { kind: "interest-upserted", interest: desiredInterest(id) },
      DEFAULT_ZEROPS_DATA_POLICY,
    ).state,
  );
  const registry = AtomRegistry.make();
  let ordinal = 1;
  const push = (decoded: ProtocolDecodeResult) => {
    for (const input of decoded.observations) {
      registry.set(
        stateAtom,
        reduceZeropsDataState(
          registry.get(stateAtom),
          {
            kind: "observation",
            observation: { input, stamp: stamp(++ordinal), accessEvidence: null },
          },
          DEFAULT_ZEROPS_DATA_POLICY,
        ).state,
      );
    }
  };
  const { reads } = createZeropsDataAtoms(stateAtom);
  registry.set(zeropsDataRuntimeAtom, {
    reads: { ...reads, ...overrides },
  } as unknown as ManagedZeropsDataRuntime);
  const pushProject = () =>
    push(
      decodeEntityDirectResponse(directTicket({ kind: "project", ref: owner }, id), {
        id: owner.projectId,
        clientId: owner.organization.organizationId,
        name: "acme-docs-dev",
        status: "ACTIVE",
      }),
    );
  const pushServices = (list: ReadonlyArray<object>) => {
    const query = {
      kind: "services-of-project" as const,
      project: owner,
      schemaVersion: 1 as const,
    };
    push(
      decodeEntityQueryResponse(
        query,
        directTicket({ kind: "query", descriptor: query }, id, 3, 3),
        { list, totalCount: list.length },
        "direct-read",
      ),
    );
  };
  const snapshots: Array<ProjectTopologySnapshot> = [];
  const release = registry.subscribe(
    projectTopologyAtom(owner),
    (snapshot) => snapshots.push(snapshot),
    { immediate: true },
  );
  const close = () => {
    release();
    registry.dispose();
  };
  return { registry, pushProject, pushServices, snapshots, close };
}

const APP = {
  id: "app",
  name: "app",
  status: "ACTIVE",
  serviceStackTypeInfo: {
    serviceStackTypeVersionName: "nodejs@22",
    serviceStackTypeCategory: "USER",
  },
};

describe("the derived topology", () => {
  it("the topology view updates from a pushed facet with no writer", () => {
    const runtime = pushedRuntime();

    runtime.pushProject();
    runtime.pushServices([]);

    expect(runtime.snapshots[0]?.view).toBeUndefined();
    expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");
    runtime.close();
  });

  it("a service's usage reaches the view when its read changes", () => {
    const usage = Atom.make({ value: null, coverage: { kind: "none" } } as unknown as UsageRead);
    const runtime = pushedRuntime({ usage: () => usage });
    runtime.pushProject();
    runtime.pushServices([APP]);

    runtime.registry.set(usage, {
      ...runtime.registry.get(usage),
      value: {
        containers: 1,
        cpu: { used: 2, limit: 4 },
        memoryGb: { used: 1, limit: 2 },
        diskGb: { used: 1, limit: 10 },
      },
    });

    expect(runtime.snapshots.at(-1)?.view?.services[0]?.usage?.containers).toBe(1);
    runtime.close();
  });

  it("a service's history reaches the view when its read changes", () => {
    const empty = { series: { status: "unresolved", buckets: new Map() } };
    const history = Atom.make(empty as unknown as HistoryReadView);
    const runtime = pushedRuntime({ history: () => history });
    runtime.pushProject();
    runtime.pushServices([APP]);
    const before = runtime.snapshots.length;

    runtime.registry.set(history, { ...empty } as unknown as HistoryReadView);

    expect(runtime.snapshots.length).toBe(before + 1);
    runtime.close();
  });
});

describe("the project an environment belongs to (C3)", () => {
  const ENVIRONMENT = EnvironmentId.make("environment-1");
  const other = project("project-2");
  const inventory = {
    projectRefs: new Map([
      [projectKeyOf(owner), owner],
      [projectKeyOf(other), other],
    ]),
  };
  const nowhere: EnvironmentProjects = { described: new Map(), listed: new Map() };
  const record = (projectId: string): RegistrationRecord => ({
    targetKey: `${projectId}:zcp` as RegistrationRecord["targetKey"],
    environmentId: ENVIRONMENT,
    origin: null,
    projectRef: { projectId, orgId: organization.organizationId },
    name: null,
  });

  it.each<{
    readonly name: string;
    readonly record: RegistrationRecord | undefined;
    readonly located: EnvironmentProjects;
    readonly project: string | null;
  }>([
    { name: "nothing places it", record: undefined, located: nowhere, project: null },
    {
      name: "its descriptor states a project",
      record: undefined,
      located: { described: new Map([[ENVIRONMENT, other.projectId]]), listed: new Map() },
      project: other.projectId,
    },
    {
      name: "its registration record names a project",
      record: record(owner.projectId),
      located: nowhere,
      project: owner.projectId,
    },
    {
      name: "a listing row reaches it",
      record: undefined,
      located: { described: new Map(), listed: new Map([[ENVIRONMENT, other.projectId]]) },
      project: other.projectId,
    },
    {
      name: "its descriptor and its record disagree",
      record: record(owner.projectId),
      located: { described: new Map([[ENVIRONMENT, other.projectId]]), listed: new Map() },
      project: other.projectId,
    },
    {
      name: "its project is not in the inventory",
      record: record("project-gone"),
      located: nowhere,
      project: null,
    },
  ])("resolves $project when $name", ({ record, located, project: expected }) => {
    expect(
      environmentProjectRef({ environmentId: ENVIRONMENT, record, located, inventory })
        ?.projectId ?? null,
    ).toBe(expected);
  });
});

describe("central topology binding", () => {
  it("preserves process status, service attribution and pipeline fields", () => {
    const record = {
      ref: { processId: "process-1", project: { projectId: "project-1" } },
      identity: {
        knowledge: "observed",
        fields: {
          actionName: "stack.deploy",
          createdAt: "2026-09-07T10:00:00.000Z",
          serviceIds: ["service-1"],
        },
      },
      lifecycle: {
        knowledge: "observed",
        fields: { status: "RUNNING", startedAt: "2026-09-07T10:00:01.000Z" },
      },
      pipeline: {
        knowledge: "observed",
        fields: {
          appVersion: {
            id: "version-1",
            status: "BUILDING",
            build: {
              serviceStackId: "builder-1",
              pipelineStart: "2026-09-07T10:00:02.000Z",
            },
          },
        },
      },
    } as unknown as ProcessRecord;

    expect(processRecordToActivityProcess(record)).toMatchObject({
      id: "process-1",
      projectId: "project-1",
      serviceStackIds: ["service-1"],
      status: "RUNNING",
      appVersion: {
        id: "version-1",
        status: "BUILDING",
        build: {
          serviceStackId: "builder-1",
          pipelineStart: "2026-09-07T10:00:02.000Z",
        },
      },
    });
  });
});
