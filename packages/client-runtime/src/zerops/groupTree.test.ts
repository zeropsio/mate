import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api.ts";
import { buildZeropsGroupTree } from "./groupTree.ts";

interface Candidate {
  readonly project: ZeropsProject;
  readonly connected: boolean;
}

function candidate(name: string, tagList: ReadonlyArray<string>, connected = false): Candidate {
  return { project: { id: name, name, status: "ACTIVE", tagList }, connected };
}

const CRM_DEV = candidate("crm-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM"], true);
const CRM_PROD = candidate("crm-prod", ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"]);
const SHOP_DEV = candidate("shop-dev", ["mate:g:bbb", "mate:role:dev"]);
const LOOSE = candidate("loose", []);
const GITEA = candidate("mate-gitea", ["mate:tool:gitea"]);

describe("buildZeropsGroupTree", () => {
  it("hangs each carrier on its place in the tree", () => {
    const view = buildZeropsGroupTree([CRM_DEV, CRM_PROD, SHOP_DEV, LOOSE, GITEA]);

    // Sorted by display name, case-insensitively: the unnamed group falls
    // back to its id `bbb`, which sorts before `Beviro CRM`.
    expect(view.groups.map((entry) => entry.group.name)).toEqual(["bbb", "Beviro CRM"]);
    const crm = view.groups.find((entry) => entry.group.groupId === "aaa");
    expect(crm?.environments.map((entry) => entry.item.project.name)).toEqual([
      "crm-dev",
      "crm-prod",
    ]);
    expect(view.ungrouped.map((item) => item.project.name)).toEqual(["loose"]);
    expect(view.tools.map((tool) => tool.kind)).toEqual(["gitea"]);
  });

  it("keeps whatever the carrier knew — that is the point of being generic", () => {
    const view = buildZeropsGroupTree([CRM_DEV, CRM_PROD]);
    expect(view.groups[0]?.environments[0]?.item.connected).toBe(true);
    expect(view.groups[0]?.environments[1]?.item.connected).toBe(false);
  });

  it("carries each environment's role through", () => {
    const view = buildZeropsGroupTree([CRM_DEV, CRM_PROD]);
    expect(view.groups[0]?.environments.map((entry) => entry.role)).toEqual(["dev", "prod"]);
  });

  it("keeps a tool out of the groups even when it also carries a group tag", () => {
    const confused = candidate("confused", ["mate:g:aaa", "mate:tool:gitea"]);
    const view = buildZeropsGroupTree([CRM_DEV, confused]);

    expect(view.tools).toHaveLength(1);
    expect(view.groups[0]?.environments.map((entry) => entry.item.project.name)).toEqual([
      "crm-dev",
    ]);
  });

  it("names a group from the store when one is supplied, over the tag mirror", () => {
    const view = buildZeropsGroupTree([CRM_DEV], { names: { aaa: "Renamed In Store" } });
    expect(view.groups[0]?.group.name).toBe("Renamed In Store");
  });

  it("is empty when the account has only ungrouped projects", () => {
    const view = buildZeropsGroupTree([LOOSE]);
    expect(view.empty).toBe(true);
    expect(view.ungrouped).toHaveLength(1);
  });

  it("is not empty when the account has only a tool", () => {
    // A Gitea with no application yet is still something to show.
    expect(buildZeropsGroupTree([GITEA]).empty).toBe(false);
  });

  it("is empty for no projects at all", () => {
    const view = buildZeropsGroupTree([]);
    expect(view).toEqual({ groups: [], ungrouped: [], tools: [], empty: true });
  });

  it("collapses two carriers for one project into the newer read", () => {
    const stale = candidate("crm-dev", ["mate:g:aaa", "mate:role:dev"], false);
    const fresh = candidate("crm-dev", ["mate:g:aaa", "mate:role:dev"], true);

    const view = buildZeropsGroupTree([stale, fresh]);
    expect(view.groups[0]?.environments).toHaveLength(1);
    expect(view.groups[0]?.environments[0]?.item.connected).toBe(true);
  });
});
