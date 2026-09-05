import { buildZeropsGroupTree, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsGroupTree } from "./ZeropsGroupTree";
import {
  creatableRoles,
  environmentRoleLabel,
  environmentRoleTag,
  groupNameIsPlaceholder,
} from "./ZeropsGroupTree.logic";

interface Item {
  readonly project: ZeropsProject;
  readonly mate?: boolean;
}

function item(name: string, tagList: ReadonlyArray<string>, mate = true): Item {
  return { project: { id: name, name, status: "ACTIVE", tagList }, mate };
}

const CRM_DEV = item("crm-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM"]);
const CRM_STAGE = item("crm-stage", ["mate:g:aaa", "mate:role:stage"], false);
const CRM_PROD = item("crm-prod", ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"], false);
const GITEA = item("mate-gitea", ["mate:tool:gitea"], false);
const LOOSE = item("loose", []);

function render(items: ReadonlyArray<Item>, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ZeropsGroupTree
      getKey={(entry: Item) => entry.project.id}
      isMate={(entry: Item) => entry.mate === true}
      renderEnvironment={(entry: Item, role) => (
        <li data-test-environment={entry.project.id}>
          {entry.project.name} {environmentRoleTag(role) ?? ""}
        </li>
      )}
      renderMate={(entry: Item) => <div data-test-mate={entry.project.id} />}
      renderTool={(entry: Item, kind) => <li data-test-tool={kind}>{entry.project.name}</li>}
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
  ] as const)("writes %s as %s in a sentence", (role, expected) => {
    expect(environmentRoleLabel(role)).toBe(expected);
  });

  it("has no word for an environment with no role", () => {
    expect(environmentRoleLabel(undefined)).toBeNull();
  });
});

describe("environmentRoleTag", () => {
  it.each([
    ["dev", "dev"],
    ["devstage", "dev/stage"],
    ["stage", "stage"],
    ["prod", "prod"],
  ] as const)("writes %s as the tag %s", (role, expected) => {
    expect(environmentRoleTag(role)).toBe(expected);
  });

  it("has no tag for an environment with no role", () => {
    expect(environmentRoleTag(undefined)).toBeNull();
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
    const [group] = buildZeropsGroupTree([CRM_DEV, CRM_STAGE, CRM_PROD]).groups;
    expect(creatableRoles(group!.group)).toEqual([]);
  });
});

describe("ZeropsGroupTree", () => {
  it("renders a project as its name, its Mates as cards, then its other environments as a list", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);

    expect(html).toContain('data-zerops-group="aaa"');
    expect(html).toContain("<h2");
    expect(html).toContain(">Beviro CRM<");
    // The Mate's environment is the Mate: a card, and no row of its own.
    expect(html).toContain('data-zerops-surface="mate-cards"');
    expect(html).toContain('data-test-mate="crm-dev"');
    expect(html).not.toContain('data-test-environment="crm-dev"');
    // The rest in role order, as a list, after the cards.
    expect(html).toContain('data-zerops-surface="environment-rows"');
    expect(html).toContain('data-test-environment="crm-stage"');
    expect(html).toContain('data-test-environment="crm-prod"');
    expect(html.indexOf('data-test-mate="crm-dev"')).toBeLessThan(
      html.indexOf('data-test-environment="crm-stage"'),
    );
    expect(html.indexOf('data-test-environment="crm-stage"')).toBeLessThan(
      html.indexOf('data-test-environment="crm-prod"'),
    );
    // No table, no header row, no sentence under the name.
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain("columnheader");
    expect(html).not.toContain("environments ·");
  });

  it("draws no list for a project whose every environment is a Mate's, and no cards for one with none", () => {
    expect(render([CRM_DEV])).not.toContain('data-zerops-surface="environment-rows"');
    expect(render([CRM_PROD])).not.toContain('data-zerops-surface="mate-cards"');
  });

  it("keeps tools in their own list, never inside a project", () => {
    const html = render([CRM_DEV, GITEA]);

    expect(html).toContain('data-zerops-tools="true"');
    expect(html).toContain('data-zerops-surface="tool-rows"');
    expect(html).toContain('data-test-tool="gitea"');
    const groupSection = html.slice(html.indexOf('data-zerops-group="aaa"'));
    expect(groupSection.slice(0, groupSection.indexOf('data-zerops-tools="true"'))).not.toContain(
      "mate-gitea",
    );
  });

  it("shows ungrouped Mates and environments under their own heading", () => {
    const html = render([CRM_DEV, LOOSE, item("bare", [], false)]);
    expect(html).toContain('data-zerops-ungrouped="true"');
    expect(html).toContain(">Ungrouped<");
    expect(html).toContain('data-test-mate="loose"');
    expect(html).toContain('data-test-environment="bare"');
  });

  it("marks a project nothing has named", () => {
    const html = render([item("x", ["mate:g:zzz"])]);
    expect(html).toContain("This project has no name yet");
  });

  it("offers the missing roles under the project, only when a create handler is given", () => {
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

  it("renders the project's menu at the end of its heading, on hover", () => {
    const html = render([CRM_DEV], {
      renderGroupMenu: () => <span data-test="group-menu" />,
    });
    expect(html).toContain('data-test="group-menu"');
    expect(html).toContain("group-hover/project:opacity-100");
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
    const html = render([LOOSE, item("other", [], false)]);
    expect(html).toContain('data-test-mate="loose"');
    expect(html).toContain('data-test-environment="other"');
    expect(html).not.toContain(">Ungrouped<");
  });
});
