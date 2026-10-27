import { projectKeyOf } from "@t3tools/client-runtime/zerops/data";
import type { ProjectTopologySnapshot, AccountStore } from "@t3tools/client-runtime/data";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentProjectRef,
  projectTopologyAtom,
  zeropsSessionAtom,
  type EnvironmentProjects,
} from "../state/zerops";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { organization, project } from "./__fixtures__/platformData";

const owner = project();

/** The account store's facts and the registry that projects them. */
function pushedStore() {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: organization,
  });
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
  return {
    registry,
    pushProject,
    pushServices,
    pushUsage,
    failUsage,
    snapshots,
    close,
    access: (access: "denied" | "allowed") =>
      store!.dispatch({ kind: "access", family: "project", id: owner.projectId, access }),
  };
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
      const runtime = pushedStore();
      runtime.pushProject();
      runtime.pushServices([]);
      runtime.failUsage(kind);
      expect(runtime.snapshots.at(-1)?.error).toBe("Metrics unavailable. Try again.");
      expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");
      runtime.close();
    },
  );

  it("the topology view updates from a pushed facet with no writer", () => {
    const runtime = pushedStore();

    runtime.pushProject();
    runtime.pushServices([]);

    expect(runtime.snapshots[0]?.view).toBeUndefined();
    expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");
    runtime.close();
  });

  it("a service's usage reaches the view when its read changes", () => {
    const runtime = pushedStore();
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
    const runtime = pushedStore();
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

  it("withholds source-denied project content and restores it when allowed", () => {
    const runtime = pushedStore();
    runtime.pushProject();
    runtime.pushServices([APP]);
    expect(runtime.snapshots.at(-1)?.view?.project.name).toBe("acme-docs-dev");

    runtime.access("denied");
    expect(runtime.snapshots.at(-1)?.view).toBeUndefined();

    runtime.pushServices([APP]);
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
  const read = (projectId: string) => ({ projectId, orgId: organization.organizationId });

  it.each<{
    readonly name: string;
    readonly mate: { readonly projectId: string; readonly orgId: string | null } | undefined;
    readonly located: EnvironmentProjects;
    readonly project: string | null;
  }>([
    { name: "nothing places it", mate: undefined, located: nowhere, project: null },
    {
      name: "its descriptor states a project",
      mate: undefined,
      located: { described: new Map([[ENVIRONMENT, other.projectId]]), listed: new Map() },
      project: other.projectId,
    },
    {
      name: "the Mate this tab read serving it names a project",
      mate: read(owner.projectId),
      located: nowhere,
      project: owner.projectId,
    },
    {
      name: "a listing row reaches it",
      mate: undefined,
      located: { described: new Map(), listed: new Map([[ENVIRONMENT, other.projectId]]) },
      project: other.projectId,
    },
    {
      name: "its descriptor and its Mate's reading disagree",
      mate: read(owner.projectId),
      located: { described: new Map([[ENVIRONMENT, other.projectId]]), listed: new Map() },
      project: other.projectId,
    },
    {
      name: "its project is not in the inventory",
      mate: read("project-gone"),
      located: nowhere,
      project: null,
    },
  ])("resolves $project when $name", ({ mate, located, project: expected }) => {
    expect(
      environmentProjectRef({ environmentId: ENVIRONMENT, mate, located, inventory })?.projectId ??
        null,
    ).toBe(expected);
  });
});
