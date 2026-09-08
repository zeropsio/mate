// @effect-diagnostics nodeBuiltinImport:off -- Source ownership guards read authored files directly.
import * as NodeFS from "node:fs";
import {
  AccountEpoch,
  createZeropsDataAtoms,
  makeInitialZeropsDataState,
  makeZeropsApiOrigin,
  queryKeyOf,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type CollectionRead,
  type ProjectRecord,
  type ServiceRecord,
} from "@t3tools/client-runtime/zerops/data";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  makeZeropsAtomSelectionStore,
  stabilizeZeropsAtom,
  zeropsKnowledgeArraysEqual,
} from "./zeropsDataContext";

function source(relative: string): string {
  return NodeFS.readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("central Zerops data bindings", () => {
  it("keeps the adapter in the account provider and feature bindings free of platform I/O", () => {
    expect(source("./ZeropsDataProvider.tsx")).toContain("makeZeropsDataAdapter");
    expect(source("./ZeropsDataProvider.tsx")).toContain("setStartupFailure");
    for (const file of [
      "./ZeropsInventoryProvider.tsx",
      "./useProjectTopology.ts",
      "./useZeropsCandidates.ts",
      "./activity/useProjectActivity.ts",
    ]) {
      const contents = source(file);
      expect(contents).not.toContain("openPlatformWatch");
      expect(contents).not.toContain("loadZeropsCandidates");
      expect(contents).not.toContain("fetchProjectProcesses(");
      expect(contents).not.toContain("listProjectServices(");
      expect(contents).not.toContain("setInterval(");
    }
  });

  it("keeps all product writes behind the account runtime command facade", () => {
    const files = [
      "../components/zerops/ZeropsNewProjectWizard.tsx",
      "../components/zerops/ZeropsProjectsPage.tsx",
      "./useZcpRestart.ts",
      "./useZeropsGroupReach.ts",
      "./useZeropsProvisioning.ts",
      "./useZeropsUpgradeRestart.ts",
    ];
    const legacyMethods = [
      "restartService",
      "nameProjectAgent",
      "updateProjectGroupTags",
      "importDevelopmentContainer",
      "enableZeropsMate",
      "enableSubdomainAccess",
      "createProject",
      "createProjectWithZeropsMate",
      "importProject",
      "importServicesIntoProject",
      "createToolProject",
      "setIntegrationTokenProjects",
    ];

    for (const file of files) {
      const contents = source(file);
      for (const method of legacyMethods) expect(contents).not.toContain(`client.${method}(`);
    }
  });

  it("binds per-project views to projection families instead of the account root atom", () => {
    const topology = source("./useProjectTopology.ts");
    expect(topology).toContain("runtime.reads.topology(project)");
    expect(topology).not.toContain("runtime.stateAtom");

    const activity = source("./activity/useProjectActivity.ts");
    expect(activity).toContain("runtime.reads.activity(project)");
    expect(activity).not.toContain("runtime.stateAtom");
  });

  it("binds inventory and candidates only to their narrow projection families", () => {
    const inventory = source("./ZeropsInventoryProvider.tsx");
    expect(inventory).toContain("runtime.reads.projectsOf(");
    expect(inventory).toContain("runtime.reads.project(");
    expect(inventory).toContain("runtime.reads.servicesOf(");
    expect(inventory).not.toContain("runtime.stateAtom");

    const candidates = source("./useZeropsCandidates.ts");
    expect(candidates).toContain("runtime.reads.projectsOf(");
    expect(candidates).toContain("runtime.reads.servicesOf(");
    expect(candidates).not.toContain("runtime.stateAtom");
    expect(candidates).not.toContain("useZeropsDataState");
  });

  it("does not publish selected inventory reads for process or metric domain traffic", () => {
    const account = {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account-a"),
    };
    const organization = {
      kind: "organization" as const,
      account,
      organizationId: ZeropsOrganizationId.make("org-a"),
    };
    const project = {
      kind: "project" as const,
      organization,
      projectId: ZeropsProjectId.make("project-a"),
    };
    const projectQueryDescriptor = {
      kind: "projects-of-organization" as const,
      organization,
      statuses: [],
      schemaVersion: 1 as const,
    };
    const serviceQueryDescriptor = {
      kind: "services-of-project" as const,
      project,
      schemaVersion: 1 as const,
    };
    const initial = makeInitialZeropsDataState({ account, epoch: AccountEpoch.make(1) });
    const queries = new Map(initial.inventory.queries);
    queries.set(queryKeyOf(projectQueryDescriptor), {
      status: "unresolved",
      descriptor: projectQueryDescriptor,
      key: queryKeyOf(projectQueryDescriptor),
      memberKeys: [],
      unresolvedMemberKeys: [],
      coverage: { kind: "none" },
      lastAppliedReadStartOrdinal: null,
      membershipOperations: new Map(),
    });
    queries.set(queryKeyOf(serviceQueryDescriptor), {
      status: "unresolved",
      descriptor: serviceQueryDescriptor,
      key: queryKeyOf(serviceQueryDescriptor),
      memberKeys: [],
      unresolvedMemberKeys: [],
      coverage: { kind: "none" },
      lastAppliedReadStartOrdinal: null,
      membershipOperations: new Map(),
    });
    const settled = { ...initial, inventory: { ...initial.inventory, queries } };
    const root = Atom.make(settled);
    const reads = createZeropsDataAtoms(root).reads;
    const registry = AtomRegistry.make();
    const stableCollection = <Record extends ProjectRecord | ServiceRecord>(
      atom: Atom.Atom<CollectionRead<Record>>,
    ) =>
      stabilizeZeropsAtom(
        atom,
        (left, right) =>
          left.query === right.query &&
          zeropsKnowledgeArraysEqual(left.value, right.value) &&
          left.observation.access === right.observation.access,
      );
    const stores = [
      makeZeropsAtomSelectionStore(registry, [
        ["organizations", stableCollection(reads.projectsOf(organization))],
      ]),
      makeZeropsAtomSelectionStore(registry, [
        [
          "project",
          stabilizeZeropsAtom(reads.project(project), (left, right) =>
            zeropsKnowledgeArraysEqual([left.value], [right.value]),
          ),
        ],
      ]),
      makeZeropsAtomSelectionStore(registry, [
        ["services", stableCollection(reads.servicesOf(project))],
      ]),
    ];
    let publications = 0;
    const releases = stores.map((store) => store.subscribe(() => (publications += 1)));
    for (const store of stores) store.getSnapshot();

    for (let index = 0; index < 100; index += 1) {
      registry.set(root, {
        ...settled,
        activity: { ...settled.activity, processes: new Map(settled.activity.processes) },
        observability: {
          current: new Map(settled.observability.current),
          history: new Map(settled.observability.history),
          historyAdmission: new Map(settled.observability.historyAdmission),
        },
        retention: { ...settled.retention, nextId: index + 1 },
      });
    }

    expect(publications).toBe(0);
    for (const release of releases) release();
    registry.dispose();
  });

  it("passes the absolute verification deadline into direct-write admission", () => {
    expect(source("./ZeropsInventoryProvider.tsx")).toContain(
      "client.setWritesAllowed(true, deadlineMs)",
    );
  });

  it("removes the former topology and activity owners", () => {
    expect(NodeFS.existsSync(new URL("./projectTopologyWatcher.ts", import.meta.url))).toBe(false);
    expect(NodeFS.existsSync(new URL("./activity/projectActivityPoller.ts", import.meta.url))).toBe(
      false,
    );
  });
});
