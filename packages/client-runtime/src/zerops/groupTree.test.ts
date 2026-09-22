import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api.ts";
import { buildZeropsGroupTree } from "./groupTree.ts";

interface Candidate {
  readonly project: ZeropsProject;
  readonly connected: boolean;
}

function candidate(
  name: string,
  tagList: ReadonlyArray<string>,
  connected = false,
  created?: string,
): Candidate {
  return {
    project: {
      id: name,
      name,
      status: "ACTIVE",
      tagList,
      ...(created === undefined ? {} : { created }),
    },
    connected,
  };
}

const CRM_DEV = candidate("crm-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM"], true);
const CRM_PROD = candidate("crm-prod", ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"]);
const SHOP_DEV = candidate("shop-dev", ["mate:g:bbb", "mate:role:dev"]);
const LOOSE = candidate("loose", []);
const GITEA = candidate("mate-gitea", ["mate:tool:gitea"]);

describe("buildZeropsGroupTree", () => {
  it("hangs each carrier on its place in the tree", () => {
    const view = buildZeropsGroupTree([CRM_DEV, CRM_PROD, SHOP_DEV, LOOSE, GITEA], {
      order: "name",
    });

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
    const view = buildZeropsGroupTree([CRM_DEV, CRM_PROD], { order: "name" });
    expect(view.groups[0]?.environments[0]?.item.connected).toBe(true);
    expect(view.groups[0]?.environments[1]?.item.connected).toBe(false);
  });

  it("carries each environment's role through", () => {
    const view = buildZeropsGroupTree([CRM_DEV, CRM_PROD], { order: "name" });
    expect(view.groups[0]?.environments.map((entry) => entry.role)).toEqual(["dev", "prod"]);
  });

  it("keeps a tool out of the groups even when it also carries a group tag", () => {
    const confused = candidate("confused", ["mate:g:aaa", "mate:tool:gitea"]);
    const view = buildZeropsGroupTree([CRM_DEV, confused], { order: "name" });

    expect(view.tools).toHaveLength(1);
    expect(view.groups[0]?.environments.map((entry) => entry.item.project.name)).toEqual([
      "crm-dev",
    ]);
  });

  it("names a group from the store when one is supplied, over the tag mirror", () => {
    const view = buildZeropsGroupTree([CRM_DEV], {
      names: { aaa: "Renamed In Store" },
      order: "name",
    });
    expect(view.groups[0]?.group.name).toBe("Renamed In Store");
  });

  it("is empty when the account has only ungrouped projects", () => {
    const view = buildZeropsGroupTree([LOOSE], { order: "name" });
    expect(view.empty).toBe(true);
    expect(view.ungrouped).toHaveLength(1);
  });

  it("is not empty when the account has only a tool", () => {
    // A Gitea with no application yet is still something to show.
    expect(buildZeropsGroupTree([GITEA], { order: "name" }).empty).toBe(false);
  });

  it("is empty for no projects at all", () => {
    const view = buildZeropsGroupTree([], { order: "name" });
    expect(view).toEqual({ groups: [], ungrouped: [], tools: [], empty: true });
  });

  it("collapses two carriers for one project into the newer read", () => {
    const stale = candidate("crm-dev", ["mate:g:aaa", "mate:role:dev"], false);
    const fresh = candidate("crm-dev", ["mate:g:aaa", "mate:role:dev"], true);

    const view = buildZeropsGroupTree([stale, fresh], { order: "name" });
    expect(view.groups[0]?.environments).toHaveLength(1);
    expect(view.groups[0]?.environments[0]?.item.connected).toBe(true);
  });

  it("ranks the ungrouped list by `options.rank` ahead of name, leaving groups untouched", () => {
    const zebra = candidate("zebra", []);
    const apple = candidate("apple", []);
    const rank = (item: Candidate) => (item.project.name === "zebra" ? 0 : 1);

    const view = buildZeropsGroupTree([CRM_DEV, CRM_PROD, zebra, apple], { rank, order: "name" });

    expect(view.ungrouped.map((item) => item.project.name)).toEqual(["zebra", "apple"]);
    expect(view.groups[0]?.environments.map((entry) => entry.item.project.name)).toEqual([
      "crm-dev",
      "crm-prod",
    ]);
  });

  it("keeps name order as the tiebreak within a rank tier", () => {
    const rank = () => 0;
    const view = buildZeropsGroupTree(
      [candidate("zebra", []), candidate("apple", []), candidate("mango", [])],
      { rank, order: "name" },
    );

    expect(view.ungrouped.map((item) => item.project.name)).toEqual(["apple", "mango", "zebra"]);
  });

  it("orders newest first when asked, through to the tree", () => {
    const older = candidate("older-dev", ["mate:g:aaa"], false, "2024-01-01T00:00:00Z");
    const newer = candidate("newer-dev", ["mate:g:bbb"], false, "2024-06-01T00:00:00Z");
    const undated = candidate("undated", []);

    const view = buildZeropsGroupTree([older, newer, undated], { order: "newest" });

    expect(view.groups.map((entry) => entry.group.groupId)).toEqual(["bbb", "aaa"]);
    expect(view.ungrouped.map((item) => item.project.name)).toEqual(["undated"]);
  });
});
