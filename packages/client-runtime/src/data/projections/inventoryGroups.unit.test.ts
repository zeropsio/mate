import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
} from "../../zerops/data/types.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
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

// witness: packages/client-runtime/src/data/projections/inventoryGroups.ts | (environments?.length ?? 0) > 0 || → (environments?.length ?? 0) >= 0 ||
it("PJ43: An application HQ says holds projects is never shown as an empty group while the projects' listing is not loaded, partial, denied or filtered", () => {
  const groupsOf = (listing: "not loaded" | "partial" | "denied" | "filtered") => {
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
    const groups = inventoryGroups
      .derive(
        readsOfState(store.state()),
        listing === "filtered" ? { ...key, projectIds: [] } : key,
      )
      .groups.map(({ group }) => group.groupId);
    registry.dispose();
    return groups;
  };
  expect(groupsOf("not loaded")).toEqual(["empty"]);
  expect(groupsOf("partial")).toEqual(["empty"]);
  expect(groupsOf("denied")).toEqual(["empty"]);
  expect(groupsOf("filtered")).toEqual(["empty"]);
});
