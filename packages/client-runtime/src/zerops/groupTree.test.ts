import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api.ts";
import { buildZeropsGroupTree } from "./groupTree.ts";
import type { HqPlacement } from "./hq/placement.ts";

interface Candidate {
  readonly project: ZeropsProject;
  readonly connected: boolean;
}

/** Where HQ places a project: in application `appId`, named `appName`, as `kind`. */
function placed(appId: string, kind: HqPlacement["kind"] = "mate", appName = ""): HqPlacement {
  return { appId, appName, kind, mate: null };
}

function candidate(
  name: string,
  where: {
    readonly hq?: HqPlacement;
    readonly hqTool?: ZeropsProject["hqTool"];
    readonly tagList?: ReadonlyArray<string>;
  } = {},
  connected = false,
  created?: string,
): Candidate {
  return {
    project: {
      id: name,
      name,
      status: "ACTIVE",
      tagList: where.tagList ?? [],
      ...(where.hq === undefined ? {} : { hq: where.hq }),
      ...(where.hqTool === undefined ? {} : { hqTool: where.hqTool }),
      ...(created === undefined ? {} : { created }),
    },
    connected,
  };
}

const CRM_DEV = candidate("crm-dev", { hq: placed("aaa", "mate", "Beviro CRM") }, true);
const CRM_PROD = candidate("crm-prod", { hq: placed("aaa", "production", "Beviro CRM") });
const SHOP_DEV = candidate("shop-dev", { hq: placed("bbb") });
const LOOSE = candidate("loose");
const GITEA = candidate("mate-gitea", { hqTool: "gitea" });

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

  it("keeps a tool out of the groups even when HQ places it in one", () => {
    const confused = candidate("confused", { hq: placed("aaa"), hqTool: "gitea" });
    const view = buildZeropsGroupTree([CRM_DEV, confused], { order: "name" });

    expect(view.tools).toHaveLength(1);
    expect(view.groups[0]?.environments.map((entry) => entry.item.project.name)).toEqual([
      "crm-dev",
    ]);
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
    const stale = candidate("crm-dev", { hq: placed("aaa") }, false);
    const fresh = candidate("crm-dev", { hq: placed("aaa") }, true);

    const view = buildZeropsGroupTree([stale, fresh], { order: "name" });
    expect(view.groups[0]?.environments).toHaveLength(1);
    expect(view.groups[0]?.environments[0]?.item.connected).toBe(true);
  });

  it("ranks the ungrouped list by `options.rank` ahead of name, leaving groups untouched", () => {
    const zebra = candidate("zebra");
    const apple = candidate("apple");
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
      [candidate("zebra"), candidate("apple"), candidate("mango")],
      { rank, order: "name" },
    );

    expect(view.ungrouped.map((item) => item.project.name)).toEqual(["apple", "mango", "zebra"]);
  });

  it("orders newest first when asked, through to the tree", () => {
    const older = candidate("older-dev", { hq: placed("aaa") }, false, "2024-01-01T00:00:00Z");
    const newer = candidate("newer-dev", { hq: placed("bbb") }, false, "2024-06-01T00:00:00Z");
    const undated = candidate("undated");

    const view = buildZeropsGroupTree([older, newer, undated], { order: "newest" });

    expect(view.groups.map((entry) => entry.group.groupId)).toEqual(["bbb", "aaa"]);
    expect(view.ungrouped.map((item) => item.project.name)).toEqual(["undated"]);
  });

  it("draws a group only a creation under way holds, and is not empty for it", () => {
    const view = buildZeropsGroupTree([LOOSE], {
      order: "newest",
      births: [
        {
          projectId: "p-new",
          startedAt: 1,
          placement: {
            groupId: "new",
            groupName: "Todo",
            kind: "mate",
            displayName: "Todo - Vera",
          },
        },
      ],
    });
    expect(view.empty).toBe(false);
    expect(view.groups).toMatchObject([
      {
        group: { groupId: "new", name: "Todo", pending: [{ projectId: "p-new" }] },
        environments: [],
      },
    ]);
  });
});
