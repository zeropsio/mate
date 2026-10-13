/** Projects grouping is owner evidence; candidate connections only decorate its members. */
import {
  buildCanonicalGroupTree,
  zeropsGroupTree,
  type CanonicalGroupTreeView,
  type ZeropsGroupTreeView,
} from "../../zerops/groupTree.ts";
import { canonicalAppEnvironments } from "./appEnvironments.ts";
import type { ZeropsPlacedBirth, ZeropsProjectOrder } from "../../zerops/groups.ts";
import type { ZeropsProject } from "../../zerops/api.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { Projection } from "../store.ts";
import { inventory, type InventoryKey } from "./inventory.ts";
import { sameValue } from "./equal.ts";

export interface InventoryGroupsKey extends InventoryKey {
  /** Only the candidates admitted by the inventory's presentation are drawn. */
  readonly projectIds: ReadonlyArray<string>;
  readonly order: ZeropsProjectOrder;
  readonly customOrder?: ReadonlyArray<string>;
  /** Accepted local intents remain visible before the platform roster catches up. */
  readonly births: ReadonlyArray<ZeropsPlacedBirth>;
}
export const canonicalInventoryGroups: Projection<
  InventoryGroupsKey,
  CanonicalGroupTreeView<{ readonly project: ZeropsProject }>
> = {
  name: "canonicalInventoryGroups",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, key) => {
    const projects = inventory
      .derive(read, key)
      .projects.filter(({ id }) => key.projectIds.includes(id));
    const apps = read.members(hqAppsScope(key.organization.organizationId)).ids.map((id) => {
      const app = read.fact("hqApp", id);
      return {
        id,
        name: app.kind === "known" ? (app.value.name ?? "Unknown") : "Unknown",
        environments: canonicalAppEnvironments.derive(read, {
          orgId: key.organization.organizationId,
          appId: id,
        }).environments,
      };
    });
    return buildCanonicalGroupTree(
      projects.map((project) => ({ project })),
      {
        order: key.order,
        ...(key.customOrder === undefined ? {} : { customOrder: key.customOrder }),
        births: key.births,
        apps,
      },
    );
  },
  equals: sameValue,
};

/** Existing web/mobile carriers remain usable until their canonical selector migration. */
export const inventoryGroups: Projection<
  InventoryGroupsKey,
  ZeropsGroupTreeView<{ readonly project: ZeropsProject }>
> = {
  ...canonicalInventoryGroups,
  equals: sameValue,
  name: "inventoryGroups",
  derive: (read, key) => {
    const tree = canonicalInventoryGroups.derive(read, key);
    return zeropsGroupTree(tree);
  },
};
