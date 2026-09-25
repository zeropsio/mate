import type * as React from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({
      to,
      params = {},
      ...props
    }: React.ComponentProps<"a"> & { to: string; params?: Record<string, string> }) =>
      createElement("a", {
        href: to.replace(/\$(\w+)/gu, (_, key: string) => params[key] ?? ""),
        ...props,
      }),
  };
});

import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { item, MERGING, renderFlow } from "./flowTestFixtures";

const render = renderFlow;

describe("the containers no project holds", () => {
  const rows = (kinds: ReadonlyArray<ZeropsRowAction["kind"]>) =>
    kinds.map((action, index) => ({ item: item(`loose-${String(index)}`, []), action }));

  it("fold into one line with their states and a re-probe for the ones not answering", () => {
    const html = render({
      groups: [MERGING],
      ungrouped: rows(["open", "retry-probe", "start", "retry-probe"]),
    });
    const line = html.slice(html.indexOf('data-zerops-surface="other-containers"'));
    expect(line).toContain("Other containers");
    expect(line).toContain("Not in a project · 1 ready · 2 not answering · 1 stopped");
    expect(line).toContain("Try again (2)");
    // Folded: the rows themselves wait behind the line.
    expect(line).not.toContain("data-test-mate=");
  });

  it("keeps their summary for a container with room for it, never a cut 'Not in a…'", () => {
    const html = render({ ungrouped: rows(["open", "start"]) });
    const summary = html.slice(
      html.lastIndexOf("<span", html.indexOf("Not in a project")),
      html.indexOf("Not in a project"),
    );
    expect(summary).toContain("hidden");
    expect(summary).toContain("@2xl/flow:block");
  });

  it("offers no re-probe when every container answers", () => {
    expect(render({ ungrouped: rows(["open"]) })).not.toContain("Try again");
  });

  it("keeps a project with no Mate container for the quiet line at the end", () => {
    const html = render({
      ungrouped: [{ item: item("zerops-ads", [], false), action: "set-up-mate" }],
    });
    expect(html).not.toContain('data-zerops-surface="other-containers"');
    const end = html.slice(html.indexOf('data-zerops-surface="quiet-end"'));
    expect(end).toContain('data-test-environment="zerops-ads"');
  });
});

describe("the tools", () => {
  const GITEA = item("mate-gitea", ["mate:tool:gitea"], false);

  it("are one quiet line at the end, after the containers", () => {
    const html = render({
      groups: [MERGING],
      tools: [{ item: GITEA, kind: "gitea" }],
      ungrouped: [{ item: item("loose", []), action: "open" }],
    });
    expect(html).toContain('data-test-tool="mate-gitea"');
    expect(html.indexOf('data-zerops-surface="other-containers"')).toBeLessThan(
      html.indexOf('data-zerops-tools="true"'),
    );
  });

  it("offer Gitea only to an account that has started and has none", () => {
    expect(render({ groups: [MERGING], onCreateTool: () => {} })).toContain("Add Gitea");
    expect(
      render({
        groups: [MERGING],
        onCreateTool: () => {},
        tools: [{ item: GITEA, kind: "gitea" }],
      }),
    ).not.toContain("Add Gitea");
    expect(render({ onCreateProject: () => {}, onCreateTool: () => {} })).not.toContain(
      "Add Gitea",
    );
  });
});

describe("first run", () => {
  it("says what a Mate is, and offers one, to an account with no project", () => {
    const html = render({ onCreateProject: () => {} });
    expect(html).toContain('data-zerops-surface="first-run"');
    expect(html).toContain("Start a project");
    expect(html).toContain('data-mate-face-size="lg"');
    expect(html).toContain('data-zerops-primitive="pill"');
  });

  it("drops the invitation once the account has a project", () => {
    expect(render({ groups: [MERGING], onCreateProject: () => {} })).not.toContain(
      'data-zerops-surface="first-run"',
    );
  });

  it("gives nothing to a view with no way to create", () => {
    expect(render()).not.toContain('data-zerops-surface="first-run"');
  });
});

describe("the view switch", () => {
  it("draws every group with work on it as a card in the Projects view, as a row in the Overview", () => {
    const projects = render({ view: "projects", groups: [MERGING] });
    expect(projects).toContain('id="project-aaa"');
    expect(projects).not.toContain('id="flow-row-aaa"');
    const overview = render({ view: "overview", groups: [MERGING] });
    expect(overview).toContain('id="flow-row-aaa"');
    expect(overview).not.toContain('id="project-aaa"');
  });
});
