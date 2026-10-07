import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
} from "../../zerops/data/types.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import { readsOfState } from "../store.ts";
import { inventoryGroups, type InventoryGroupsKey } from "./inventoryGroups.ts";

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
