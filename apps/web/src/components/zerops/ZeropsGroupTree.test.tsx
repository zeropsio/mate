import { buildZeropsGroupTree, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGroupTree } from "./ZeropsGroupTree";
import {
  creatableRoles,
  environmentRoleLabel,
  groupNameIsPlaceholder,
  groupSummaryLabel,
} from "./ZeropsGroupTree.logic";

interface Item {
  readonly project: ZeropsProject;
}

function item(name: string, tagList: ReadonlyArray<string>): Item {
  return { project: { id: name, name, status: "ACTIVE", tagList } };
}

const CRM_DEV = item("crm-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM"]);
const CRM_PROD = item("crm-prod", ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"]);
const GITEA = item("mate-gitea", ["mate:tool:gitea"]);
const LOOSE = item("loose", []);

function render(items: ReadonlyArray<Item>, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ZeropsGroupTree
      getKey={(entry: Item) => entry.project.id}
      getName={(entry: Item) => entry.project.name}
      renderStatus={() => null}
      view={buildZeropsGroupTree(items)}
      {...props}
    />,
  );
}

describe("environmentRoleLabel", () => {
  it.each([
    ["dev", "Dev"],
    ["devstage", "Dev / Stage"],
    ["stage", "Stage"],
    ["prod", "Production"],
  ] as const)("writes %s as %s", (role, expected) => {
    expect(environmentRoleLabel(role)).toBe(expected);
  });

  it("has no word for an environment with no role", () => {
    expect(environmentRoleLabel(undefined)).toBeNull();
  });
});

describe("groupSummaryLabel", () => {
  it("says production is live when exactly one member claims it", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV, CRM_PROD]).groups;
    expect(groupSummaryLabel(group!.group)).toBe("2 environments · production live");
  });

  it("names the absence, because creating it is the action offered", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV]).groups;
    expect(groupSummaryLabel(group!.group)).toBe("1 environment · no production yet");
  });

  it("surfaces a contested production rather than silently picking one", () => {
    const second = item("crm-prod-2", ["mate:g:aaa", "mate:role:prod"]);
    const [group] = buildZeropsGroupTree([CRM_PROD, second]).groups;
    expect(groupSummaryLabel(group!.group)).toBe("2 environments · 2 claim production");
  });
});

describe("groupNameIsPlaceholder", () => {
  it("is true for a group nothing has named", () => {
    const [group] = buildZeropsGroupTree([item("x", ["mate:g:zzz"])]).groups;
    expect(groupNameIsPlaceholder(group!.group)).toBe(true);
  });

  it("is false once a label tag names it", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV]).groups;
    expect(groupNameIsPlaceholder(group!.group)).toBe(false);
  });
});

describe("creatableRoles", () => {
  it("offers only the roles a group does not have", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV]).groups;
    expect(creatableRoles(group!.group)).toEqual(["stage", "prod"]);
  });

  it("offers nothing once dev, stage and production all exist", () => {
    const [group] = buildZeropsGroupTree([
      CRM_DEV,
      item("crm-stage", ["mate:g:aaa", "mate:role:stage"]),
      CRM_PROD,
    ]).groups;
    expect(creatableRoles(group!.group)).toEqual([]);
  });
});

describe("ZeropsGroupTree", () => {
  it("renders a group, its name and its environments with their roles", () => {
    const html = render([CRM_DEV, CRM_PROD]);

    expect(html).toContain('data-zerops-group="aaa"');
    expect(html).toContain("Beviro CRM");
    expect(html).toContain("crm-dev");
    expect(html).toContain("Dev");
    expect(html).toContain("Production");
  });

  it("keeps tools in their own section, never inside a group", () => {
    const html = render([CRM_DEV, GITEA]);

    expect(html).toContain("Tools");
    expect(html).toContain("Gitea");
    // The tool is not a member of the group's own section.
    const groupSection = html.slice(html.indexOf('data-zerops-group="aaa"'));
    expect(groupSection.slice(0, groupSection.indexOf("Tools"))).not.toContain("Gitea");
  });

  it("shows ungrouped projects under their own heading", () => {
    const html = render([CRM_DEV, LOOSE]);
    expect(html).toContain("Ungrouped");
    expect(html).toContain("loose");
  });

  it("marks a group nothing has named", () => {
    const html = render([item("x", ["mate:g:zzz"])]);
    expect(html).toContain("This group has no name yet");
  });

  it("offers the missing roles only when a create handler is given", () => {
    expect(render([CRM_DEV])).not.toContain("Add production");
    expect(render([CRM_DEV], { onCreateEnvironment: () => {} })).toContain("Add production");
  });

  it("disables every create affordance while a creation runs", () => {
    // Disabled, not hidden: a second click would make a second project, and
    // a button that vanishes under the pointer reads as a bug.
    const html = render([CRM_DEV], {
      creating: true,
      onCreateEnvironment: () => {},
      onCreateTool: () => {},
    });
    expect(html).toContain("Add production");
    expect(html).toContain("Add Gitea");
    expect(html.match(/<button[^>]*disabled/gu)).toHaveLength(3);
  });

  it("offers Gitea only when the account has none", () => {
    expect(render([CRM_DEV], { onCreateTool: () => {} })).toContain("Add Gitea");
    expect(render([CRM_DEV, GITEA], { onCreateTool: () => {} })).not.toContain("Add Gitea");
  });

  it("renders the injected status rather than deciding one", () => {
    const html = renderToStaticMarkup(
      <ZeropsGroupTree
        getKey={(entry: Item) => entry.project.id}
        getName={(entry: Item) => entry.project.name}
        renderStatus={(entry: Item) => <span>status:{entry.project.name}</span>}
        view={buildZeropsGroupTree([CRM_DEV])}
      />,
    );
    expect(html).toContain("status:crm-dev");
  });

  it("renders rows as buttons only when they can be selected", () => {
    expect(render([CRM_DEV])).not.toContain("<button");
    expect(render([CRM_DEV], { onSelect: () => {} })).toContain("<button");
  });

  it("renders nothing but an empty nav for an account with no projects", () => {
    const html = render([]);
    expect(html).toContain('data-zerops-surface="group-tree"');
    expect(html).not.toContain("Tools");
    expect(html).not.toContain("Ungrouped");
  });
});

describe("tool status", () => {
  it("asks the caller a different question for a tool than for an environment", () => {
    const html = render([GITEA], {
      renderStatus: () => <span>ENV-STATUS</span>,
      renderToolStatus: () => <span>TOOL-STATUS</span>,
    });
    expect(html).toContain("TOOL-STATUS");
    expect(html).not.toContain("ENV-STATUS");
  });

  it("falls back to the environment status when the caller has nothing better", () => {
    const html = render([GITEA], { renderStatus: () => <span>ENV-STATUS</span> });
    expect(html).toContain("ENV-STATUS");
  });
});

describe("the row's cells", () => {
  it("reserves the action cell on every row once any row can act, so rows keep their shape", () => {
    const html = render([CRM_DEV, LOOSE], {
      renderAction: (entry: Item) =>
        entry.project.id === "crm-dev" ? <button type="button">Connect</button> : null,
    });
    expect(html.match(/data-zerops-row-cell="action"/gu)).toHaveLength(2);
    expect(html).toContain("Connect");
  });

  it("has no action cell when nothing on the page can act", () => {
    expect(render([CRM_DEV])).not.toContain('data-zerops-row-cell="action"');
    expect(render([CRM_DEV])).toContain('data-zerops-row-cell="status"');
  });

  it("lists tools after the ungrouped environments: account-level, so last", () => {
    const html = render([CRM_DEV, GITEA, LOOSE]);
    expect(html.indexOf('data-zerops-group="aaa"')).toBeLessThan(html.indexOf("Ungrouped"));
    expect(html.indexOf("Ungrouped")).toBeLessThan(html.indexOf("Tools"));
  });
});
