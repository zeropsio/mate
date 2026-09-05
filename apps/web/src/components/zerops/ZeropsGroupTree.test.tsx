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
  readonly mate?: boolean;
}

function item(name: string, tagList: ReadonlyArray<string>, mate = true): Item {
  return { project: { id: name, name, status: "ACTIVE", tagList }, mate };
}

const CRM_DEV = item("crm-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM"]);
const CRM_PROD = item("crm-prod", ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"], false);
const GITEA = item("mate-gitea", ["mate:tool:gitea"], false);
const LOOSE = item("loose", []);

function render(items: ReadonlyArray<Item>, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ZeropsGroupTree
      getKey={(entry: Item) => entry.project.id}
      renderEnvironment={(entry: Item, role) => (
        <div data-test-environment={entry.project.id} data-test-mate={entry.mate === true}>
          {environmentRoleLabel(role) ?? "—"} {entry.project.name}
        </div>
      )}
      renderTool={(entry: Item, kind) => <div data-test-tool={kind}>{entry.project.name}</div>}
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
  it("renders a project as a heading with its summary, and one table with a row per environment", () => {
    const html = render([CRM_DEV, CRM_PROD]);

    expect(html).toContain('data-zerops-group="aaa"');
    expect(html).toContain("<h2");
    expect(html).toContain(">Beviro CRM<");
    expect(html).toContain("2 environments · production live");
    expect(html).toContain('role="table"');
    expect(html).toContain('data-zerops-surface="environment-table-header"');
    // Every environment is one row, in role order, whether or not a Mate lives in it.
    expect(html).toContain('data-test-environment="crm-dev"');
    expect(html).toContain('data-test-environment="crm-prod"');
    expect(html.indexOf('data-test-environment="crm-dev"')).toBeLessThan(
      html.indexOf('data-test-environment="crm-prod"'),
    );
    expect(html.match(/data-test-environment=/gu)).toHaveLength(2);
  });

  it("names the columns once per table", () => {
    const html = render([CRM_DEV, CRM_PROD]);
    expect(html.match(/data-zerops-surface="environment-table-header"/gu)).toHaveLength(1);
    expect(html).toContain(">Mate<");
    expect(html).toContain(">Public access<");
  });

  it("keeps tools in their own table, never inside a project", () => {
    const html = render([CRM_DEV, GITEA]);

    expect(html).toContain('data-zerops-tools="true"');
    expect(html).toContain('data-test-tool="gitea"');
    // A tool is not a Mate, and its table's first column says so.
    expect(html).toContain(">Tool<");
    // The tool is not a member of the group's own section.
    const groupSection = html.slice(html.indexOf('data-zerops-group="aaa"'));
    expect(groupSection.slice(0, groupSection.indexOf('data-zerops-tools="true"'))).not.toContain(
      "mate-gitea",
    );
  });

  it("shows ungrouped environments under their own heading", () => {
    const html = render([CRM_DEV, LOOSE]);
    expect(html).toContain('data-zerops-ungrouped="true"');
    expect(html).toContain(">Ungrouped<");
    expect(html).toContain('data-test-environment="loose"');
  });

  it("marks a project nothing has named", () => {
    const html = render([item("x", ["mate:g:zzz"])]);
    expect(html).toContain("This project has no name yet");
  });

  it("offers the missing roles in the table's foot, only when a create handler is given", () => {
    expect(render([CRM_DEV])).not.toContain("Add production");
    const html = render([CRM_DEV], { onCreateEnvironment: () => {} });
    expect(html).toContain('data-zerops-surface="add-roles"');
    expect(html).toContain("Add stage");
    expect(html).toContain("Add production");
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

  it("renders the project's menu beside its heading", () => {
    const html = render([CRM_DEV], {
      renderGroupMenu: () => <span data-test="group-menu" />,
    });
    expect(html).toContain('data-test="group-menu"');
  });

  it("renders nothing but an empty nav for an account with no projects", () => {
    const html = render([]);
    expect(html).toContain('data-zerops-surface="group-tree"');
    expect(html).not.toContain("Tools");
    expect(html).not.toContain("Ungrouped");
  });

  it("lists tools after the ungrouped environments: account-level, so last", () => {
    const html = render([CRM_DEV, GITEA, LOOSE]);
    expect(html.indexOf('data-zerops-group="aaa"')).toBeLessThan(
      html.indexOf('data-zerops-ungrouped="true"'),
    );
    expect(html.indexOf('data-zerops-ungrouped="true"')).toBeLessThan(
      html.indexOf('data-zerops-tools="true"'),
    );
  });
});

describe("an account of loose projects", () => {
  it("is a list, not an 'Ungrouped' section with nothing to be distinct from", () => {
    const html = render([LOOSE, item("other", [])]);
    expect(html).toContain('data-test-environment="loose"');
    expect(html).toContain('data-test-environment="other"');
    expect(html).not.toContain(">Ungrouped<");
  });
});
