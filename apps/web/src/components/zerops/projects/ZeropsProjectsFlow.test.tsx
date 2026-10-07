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

import { act } from "react";

import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { FLOW_PROPS, item, MERGING, mount, renderFlow, type Item } from "./flowTestFixtures";
import { ZeropsProjectsFlow } from "./ZeropsProjectsFlow";

const render = renderFlow;

describe("the containers no project holds", () => {
  const rows = (kinds: ReadonlyArray<ZeropsRowAction["kind"]>) =>
    kinds.map((action, index) => ({ item: item(`loose-${String(index)}`), action }));

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

  it("count a project with no Mate in the one folded group, its row inside it", () => {
    const rows = [
      { item: item("loose"), action: "open" as const },
      { item: item("zerops-ads", undefined, false), action: "set-up-mate" as const },
    ];
    const html = render({ ungrouped: rows });
    expect(html).toContain("Not in a project · 1 ready · 1 without a Mate");
    const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} ungrouped={rows} />);
    const fold = tree.root.findByProps({ "data-zerops-surface": "other-containers" });
    expect(fold.findAll((node) => node.children.join("") === "2")).not.toHaveLength(0);
    expect(tree.root.findAllByProps({ "data-test-environment": "zerops-ads" })).toHaveLength(0);
    act(() => fold.findByProps({ "aria-expanded": false }).props.onClick());
    expect(tree.root.findAllByProps({ "data-test-environment": "zerops-ads" })).toHaveLength(1);
    expect(tree.root.findAllByProps({ "data-test-mate": "loose" })).toHaveLength(1);
  });
});

describe("HQ's card", () => {
  it("is the page's quiet end, after the containers, under no Tools label", () => {
    const html = render({
      groups: [MERGING],
      ungrouped: [{ item: item("loose"), action: "open" }],
    });
    expect(html.indexOf('data-zerops-surface="other-containers"')).toBeLessThan(
      html.indexOf('data-test-hq-card="true"'),
    );
    expect(html.indexOf('data-zerops-surface="quiet-end"')).toBeLessThan(
      html.indexOf('data-test-hq-card="true"'),
    );
    expect(html).not.toContain(">Tools<");
  });

  it("waits for an account that has started", () => {
    expect(render({ onCreateProject: () => {} })).not.toContain('data-test-hq-card="true"');
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

it("does not declare a first run before HQ placement is read", () => {
  const html = render({
    onCreateProject: () => {},
    placementNotice: "Placement not read — HQ is unavailable",
  });
  expect(html).not.toContain("Start a project");
  expect(html).toContain("Placement not read — HQ is unavailable");
});
