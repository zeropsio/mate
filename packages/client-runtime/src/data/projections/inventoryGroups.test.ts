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
