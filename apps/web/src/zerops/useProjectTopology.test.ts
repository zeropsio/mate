import {
  DEFAULT_ZEROPS_DATA_POLICY,
  createZeropsDataAtoms,
  makeInitialZeropsDataState,
  projectKeyOf,
  reduceZeropsDataState,
  type ManagedZeropsDataRuntime,
} from "@t3tools/client-runtime/zerops/data";
import type { AccountStore } from "@t3tools/client-runtime/data";
import type { RegistrationRecord } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentProjectRef,
  projectTopologyAtom,
  zeropsDataRuntimeAtom,
  zeropsInventoryAtom,
  type EnvironmentProjects,
  type ProjectTopologySnapshot,
} from "../state/zerops";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import type { InventoryProjection } from "./inventoryContext";
import {
  desiredInterest,
  identity,
  organization,
  project,
  scope,
} from "./__fixtures__/platformData";

const owner = project();

/** The account's inventory as its product publishes it, the project's authority as given. */
const inventoryWith = (
  authority: InventoryProjection["account"],
  account: InventoryProjection["account"] = { kind: "authorized" },
): InventoryProjection => ({
  projects: [],
  projectRefs: new Map([[projectKeyOf(owner), owner]]),
  authority: new Map([[projectKeyOf(owner), authority]]),
  account,
});

/** A data runtime whose state the test pushes facets into, and the registry it lives in. */
function pushedRuntime() {
  const id = identity();
  const stateAtom = Atom.make(
    reduceZeropsDataState(
      makeInitialZeropsDataState(scope()),
      { kind: "interest-upserted", interest: desiredInterest(id) },
      DEFAULT_ZEROPS_DATA_POLICY,
    ).state,
  );
  const registry = AtomRegistry.make();
  const { reads } = createZeropsDataAtoms(stateAtom);
  registry.set(zeropsDataRuntimeAtom, {
    reads,
  } as unknown as ManagedZeropsDataRuntime);
  registry.set(zeropsInventoryAtom, inventoryWith({ kind: "authorized" }));
  // The project and its services are the account store's: its roster and the organization's
  // services listing list them.
  const projectRow = {
    id: owner.projectId,
    clientId: owner.organization.organizationId,
    name: "acme-docs-dev",
    status: "ACTIVE",
  };
  let store: AccountStore | null = null;
  const pushProject = () => {
    store = mountRoster(registry, owner.organization.organizationId, [projectRow]);
  };
  const pushServices = (
    list: ReadonlyArray<{ readonly id: string; readonly name: string; readonly status: string }>,
  ) => {
    store = mountRoster(registry, owner.organization.organizationId, [projectRow], {
      services: list.map((row) => ({ ...row, projectId: owner.projectId })),
    });
  };
  /** The project's resources, as the account's store observes them while the panel shows them. */
  const scopeOf = (suffix: "usage" | "usage-history") =>
    `zerops:${owner.organization.organizationId}:${suffix}:${owner.organization.organizationId}/${owner.projectId}` as const;
  const begin = (suffix: "usage" | "usage-history") => {
    for (const event of [
      { kind: "demand", demanded: true },
      { kind: "attempt" },
      { kind: "handshake" },
    ] as const)
      store!.dispatch({ kind: "stream", key: scopeOf(suffix), now: 0, event });
  };
  const pushUsage = (
    suffix: "usage" | "usage-history",
    rows: ReadonlyArray<{ readonly id: string; readonly value: object }>,
  ) => {
    begin(suffix);
    const scope = scopeOf(suffix);
    store!.dispatch({ kind: "baseline-begin", scope, generation: 1 });
    store!.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: rows.map((row) => row.id),
      rows: rows.map((row) => ({
        family: suffix === "usage" ? "usage" : "usageHistory",
        id: row.id,
        value: row.value as never,
        revision: { kind: "zerops", version: null },
      })),
    });
  };
  const failUsage = (suffix: "usage" | "usage-history") => {
    begin(suffix);
    store!.dispatch({
      kind: "stream",
      key: scopeOf(suffix),
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "definitive-refusal", message: "Metrics unavailable. Try again." },
      },
    });
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
  return { registry, pushProject, pushServices, pushUsage, failUsage, snapshots, close };
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
  it.each(["usage", "usage-history"] as const)(
    "shows the %s read's failure while keeping the topology",
    (kind) => {
      const runtime = pushedRuntime();
      runtime.pushProject();
      runtime.pushServices([]);
      runtime.failUsage(kind);
      expect(runtime.snapshots.at(-1)?.error).toBe("Metrics unavailable. Try again.");
      expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");
      runtime.close();
    },
  );

  it("the topology view updates from a pushed facet with no writer", () => {
    const runtime = pushedRuntime();

    runtime.pushProject();
    runtime.pushServices([]);

    expect(runtime.snapshots[0]?.view).toBeUndefined();
    expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");
    runtime.close();
  });

  it("a service's usage reaches the view when its read changes", () => {
    const runtime = pushedRuntime();
    runtime.pushProject();
    runtime.pushServices([APP]);
    expect(runtime.snapshots.at(-1)?.view?.usageRead).toBe(false);

    runtime.pushUsage("usage", [
      {
        id: "c1",
        value: {
          serviceId: "app",
          containerId: "c1",
          cpu: { used: 0, limit: 0 },
          vCpu: { used: 2, limit: 4 },
          ramGBytes: { used: 1, limit: 2 },
          diskGBytes: { used: 1, limit: 10 },
        },
      },
    ]);

    expect(runtime.snapshots.at(-1)?.view?.usageRead).toBe(true);
    expect(runtime.snapshots.at(-1)?.view?.services[0]?.usage).toEqual({
      containers: 1,
      cores: { used: 2, limit: 4 },
      memoryGb: { used: 1, limit: 2 },
      diskGb: { used: 1, limit: 10 },
    });
    runtime.close();
  });

  it("a service's history reaches the view when its read changes", () => {
    const runtime = pushedRuntime();
    runtime.pushProject();
    runtime.pushServices([APP]);

    runtime.pushUsage("usage-history", [
      {
        id: "app|10|11",
        value: { serviceStackId: "app", from: "2026-10-06T10:00:00Z", till: "11", vCpuUsed: 1 },
      },
    ]);

    expect(runtime.snapshots.at(-1)?.view?.services[0]?.history).toEqual([
      {
        at: "2026-10-06T10:00:00Z",
        containers: 0,
        cores: { used: 1, limit: 0 },
        memoryGb: { used: 0, limit: 0 },
        diskGb: { used: 0, limit: 0 },
      },
    ]);
    runtime.close();
  });

  // DESIGN §4.2 G12: withheld at the read, per project and with a lapse, and back with authority.
  it.each([
    ["its project", inventoryWith({ kind: "withheld", reason: "access-unverified", cause: null })],
    [
      "the account",
      inventoryWith(
        { kind: "authorized" },
        { kind: "withheld", reason: "access-lapsed", cause: null },
      ),
    ],
  ])("shows nothing of a project while the grant withholds %s", (_scope, withheld) => {
    const runtime = pushedRuntime();
    runtime.pushProject();
    runtime.pushServices([APP]);
    expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");

    runtime.registry.set(zeropsInventoryAtom, withheld);
    expect(runtime.snapshots.at(-1)?.view).toBeUndefined();

    runtime.registry.set(zeropsInventoryAtom, inventoryWith({ kind: "authorized" }));
    expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");
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
