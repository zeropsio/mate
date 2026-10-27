import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
} from "../../zerops/data/types.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { linkKeys } from "../model.ts";
import { hqAppFamily, hqAppsScope } from "../families/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import {
  canonicalInventoryGroups,
  inventoryGroups,
  type InventoryGroupsKey,
} from "./inventoryGroups.ts";

const key: InventoryGroupsKey = {
  organization: {
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.test"),
      accountId: ZeropsAccountId.make("account"),
    },
    organizationId: ZeropsOrganizationId.make("org"),
  },
  viewer: { id: "org", name: "Org", roleCode: "OWNER", membershipId: "owner" },
  projectIds: ["mate"],
  order: "name",
  births: [],
};
function fixture() {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [{ id: "mate", name: "Ada", status: "ACTIVE" }]);
  return {
    registry,
    store,
    read: (input = key) => inventoryGroups.derive(readsOfState(store.state()), input),
  };
}
const structure = {
  ungrouped: [],
  apps: [
    {
      id: "shop",
      name: "Shop",
      projects: [{ projectId: "mate", name: "Ada", kind: "mate" as const, mate: { face: "face" } }],
    },
    { id: "empty", name: "Empty", projects: [] },
  ],
};

describe("Projects inventory grouping", () => {
  it("keeps cold placement unknown, then shows HQ's grouping and its explicitly empty app", () => {
    const f = fixture();
    expect(f.read().groups).toEqual([]);
    expect(f.read().ungrouped[0]?.project.hq).toBeUndefined();
    seedHqNavigation(f.store, "org", { structure });
    expect(f.read().groups.map(({ group }) => group.groupId)).toEqual(["empty", "shop"]);
    expect(
      f.read().groups.find(({ group }) => group.groupId === "shop")?.environments[0]?.item.project
        .id,
    ).toBe("mate");
    f.registry.dispose();
  });
  it("retains known grouping during HQ recovery", () => {
    const f = fixture();
    seedHqNavigation(f.store, "org", { structure });
    const atom = f.store.data.project(inventoryGroups, key);
    const release = f.registry.mount(atom);
    const before = f.registry.get(atom);
    f.store.dispatch({
      kind: "stream",
      key: linkKeys.hq("org"),
      now: 0,
      event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "503" } },
    });
    expect(f.registry.get(atom)).toBe(before);
    release();
    f.registry.dispose();
  });
  it("keeps an accepted creation visible before the platform lists its project", () => {
    const f = fixture();
    const pending = f.read({
      ...key,
      births: [
        {
          projectId: "new",
          startedAt: 0,
          placement: {
            groupId: "new-shop",
            groupName: "New Shop",
            kind: "mate",
            displayName: "Bea",
          },
        },
      ],
    });
    expect(pending.groups[0]?.group).toMatchObject({
      groupId: "new-shop",
      pending: [{ projectId: "new", name: "Bea" }],
    });
    f.registry.dispose();
  });
  it("does not draw a denied member as an environment or an ungrouped container", () => {
    const f = fixture();
    seedHqNavigation(f.store, "org", { structure });
    f.store.dispatch({ kind: "access", family: "project", id: "mate", access: "denied" });
    expect(f.read().groups.flatMap(({ environments }) => environments)).toEqual([]);
    expect(f.read().ungrouped).toEqual([]);
    f.registry.dispose();
  });
});

it("An HQ environment arriving after first paint appears once under its application.", () => {
  const registry = AtomRegistry.make();
  const f = { registry, store: makeAccountStore(registry) };
  const derive = () =>
    canonicalInventoryGroups.derive(readsOfState(f.store.state()), {
      ...key,
      projectIds: ["mate", "project-stage"],
    });
  expect(derive().groups).toEqual([]);
  const environment = {
    id: HqEnvironmentId.make("environment-stage"),
    target: { kind: "zerops" as const, projectId: ProjectId.make("project-stage") },
    tier: "stage" as const,
    name: "Stage",
    sources: ["main"],
    order: 1,
    keyHeld: true,
    keyInvalid: false,
    jobs: [],
  };
  const seed = {
    structure: {
      ungrouped: [],
      apps: [{ id: "shop", name: "Shop", projects: [], environments: [environment] }],
    },
  };
  seedHqNavigation(f.store, "org", seed);
  const before = derive().groups[0]!;
  expect(before.group.groupId).toBe("shop");
  expect(
    before.environments.map((entry) => (entry.kind === "managed" ? entry.id : entry.project.id)),
  ).toEqual(["environment-stage"]);
  expect(before.environments[0]?.item).toBeUndefined();
  mountRoster(
    f.registry,
    "org",
    [{ id: "project-stage", name: "Shop - Stage", status: "ACTIVE" }],
    { into: f.store },
  );
  seedHqNavigation(f.store, "org", seed);
  expect(derive().ungrouped).toEqual([]);
  const legacy = inventoryGroups.derive(readsOfState(f.store.state()), {
    ...key,
    projectIds: ["mate", "project-stage"],
  });
  expect(legacy.ungrouped).toEqual([]);
  expect(
    legacy.groups.flatMap(({ environments }) => environments.map(({ item }) => item.project.id)),
  ).toEqual(["project-stage"]);
  const after = derive().groups[0]!;
  expect(
    after.environments.map((entry) => (entry.kind === "managed" ? entry.id : entry.project.id)),
  ).toEqual(["environment-stage"]);
  expect(after.environments[0]?.item?.project.id).toBe("project-stage");
  f.store.dispatch({
    kind: "stream",
    key: linkKeys.hq("org"),
    now: 1,
    event: {
      kind: "fault",
      jitter: 0,
      fault: { outcome: "definitive-refusal", message: "Refused" },
    },
  });
  expect(
    derive().groups[0]?.environments.map((entry) =>
      entry.kind === "managed" ? entry.id : entry.project.id,
    ),
  ).toEqual(["environment-stage"]);
  expect(
    canonicalInventoryGroups.derive(readsOfState(f.store.state()), {
      ...key,
      organization: { ...key.organization, organizationId: ZeropsOrganizationId.make("other") },
    }).groups,
  ).toEqual([]);
  f.registry.dispose();
});

const stage = {
  id: HqEnvironmentId.make("environment-stage"),
  target: { kind: "zerops" as const, projectId: ProjectId.make("project-stage") },
  tier: "stage" as const,
  name: "Stage",
  sources: ["main"],
  order: 1,
  keyHeld: true,
  keyInvalid: false,
  jobs: [],
};
const placed = [
  { projectId: "mate", name: "Ada", kind: "mate", mate: { face: "face" } },
  { projectId: "project-stage", name: "Stage", kind: "stage", mate: null },
  { projectId: "project-prod", name: "Production", kind: "production", mate: null },
];
const placedKey = { ...key, projectIds: placed.map(({ projectId }) => projectId) };
function placedFixture() {
  const registry = AtomRegistry.make();
  const store = mountRoster(
    registry,
    "org",
    placed.map(({ projectId, name }) => ({ id: projectId, name, status: "ACTIVE" })),
  );
  return {
    registry,
    store,
    read: () => inventoryGroups.derive(readsOfState(store.state()), placedKey),
  };
}

it.each(["refused", "unknown", "absent", "undecodable", "empty", "partial"] as const)(
  "Known stage and production placements remain visible when environments are %s.",
  (state) => {
    const f = placedFixture();
    seedHqNavigation(f.store, "org", {
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "shop",
            name: "Shop",
            projects: placed,
            environments:
              state === "partial"
                ? [stage]
                : state === "empty"
                  ? []
                  : { refused: "changes_not_seen" },
          },
        ],
      },
    });
    if (state === "unknown" || state === "absent" || state === "undecodable") {
      const fact = readsOfState(f.store.state()).fact("hqApp", "shop");
      if (fact.kind !== "known") throw new Error("Expected seeded application");
      const { environments: _environments, ...raw } = fact.value;
      const value = hqAppFamily.hq!.decode(
        state === "absent"
          ? raw
          : {
              ...raw,
              environments:
                state === "unknown" ? undefined : [{ ...stage, target: { kind: "future" } }],
            },
        "app:shop",
      )!;
      const scope = hqAppsScope("org");
      f.store.dispatch({
        kind: "delivery",
        via: "hq-stream",
        reset: false,
        scopes: [{ scope, generation: f.store.state().streams.get(scope)!.generation }],
        rows: [
          {
            family: "hqApp",
            id: "shop",
            value,
            revision: { kind: "hq", incarnation: "seed", revision: 100000 },
          },
        ],
        removals: [],
      });
    }
    const tree = f.read();
    expect(tree.groups[0]?.environments.map(({ item, role }) => [item.project.id, role])).toEqual([
      ["mate", "dev"],
      ["project-stage", "stage"],
      ["project-prod", "prod"],
    ]);
    expect(tree.groups[0]?.group.production?.project.id).toBe("project-prod");
    expect(tree.ungrouped).toEqual([]);
    f.registry.dispose();
  },
);

it.each(["stage", "production"] as const)(
  "A pending-attach %s stays in its application beside recorded environments.",
  (kind) => {
    const f = placedFixture();
    seedHqNavigation(f.store, "org", {
      structure: {
        ungrouped: [],
        apps: [{ id: "shop", name: "Shop", projects: [placed[0]!], environments: [stage] }],
      },
      presses: {
        "project-prod": { kind, appId: "shop", heldForMs: 30000, until: "2026-10-13T00:00:30Z" },
      },
    });
    const tree = f.read();
    expect(tree.groups[0]?.environments.map(({ item }) => item.project.id)).toEqual([
      "mate",
      ...(kind === "stage" ? ["project-prod", "project-stage"] : ["project-stage", "project-prod"]),
    ]);
    expect(
      tree.groups[0]?.environments.find(({ item }) => item.project.id === "project-prod")?.role,
    ).toBe(kind === "stage" ? "stage" : "prod");
    expect(tree.ungrouped).toEqual([]);
    f.registry.dispose();
  },
);

it.each(["not loaded", "partial", "denied", "filtered"] as const)(
  "A %s listing never turns an HQ non-empty application into an empty group.",
  (listing) => {
    const registry = AtomRegistry.make();
    const store =
      listing === "not loaded"
        ? makeAccountStore(registry)
        : mountRoster(
            registry,
            "org",
            listing === "denied" || listing === "filtered"
              ? [{ id: "mate", name: "Ada", status: "ACTIVE" }]
              : [],
          );
    seedHqNavigation(store, "org", { structure });
    if (listing === "denied")
      store.dispatch({ kind: "access", family: "project", id: "mate", access: "denied" });
    expect(
      inventoryGroups
        .derive(
          readsOfState(store.state()),
          listing === "filtered" ? { ...key, projectIds: [] } : key,
        )
        .groups.map(({ group }) => group.groupId),
    ).toEqual(["empty"]);
    registry.dispose();
  },
);

it("An HQ non-empty application with no visible placements is never offered as an empty group.", () => {
  const f = fixture();
  seedHqNavigation(f.store, "org", {
    structure: {
      ungrouped: [],
      apps: [
        {
          id: "hidden",
          name: "Hidden",
          projects: [],
          contents: { empty: false, deletingProjectIds: [] },
          environments: { refused: "changes_not_seen" },
        },
        {
          id: "empty",
          name: "Empty",
          projects: [],
          contents: { empty: true, deletingProjectIds: [] },
        },
      ],
    },
  });
  expect(f.read().groups.map(({ group }) => group.groupId)).toEqual(["empty"]);
  f.registry.dispose();
});
