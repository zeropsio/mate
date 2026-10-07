import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

const { stopLinkOf, ZeropsEnvironmentRow, ZeropsRoleTag } = await import("./ZeropsEnvironmentRow");

function row(props: Partial<React.ComponentProps<typeof ZeropsEnvironmentRow>> = {}) {
  return renderToStaticMarkup(
    <ul>
      <ZeropsEnvironmentRow
        name="Acme Docs - stage"
        summary="app, db · deployed 2h ago"
        tag="stage"
        {...props}
      />
    </ul>,
  );
}

describe("ZeropsEnvironmentRow", () => {
  it("is a row of a list with three places: the name and its tag, what it holds, and the end", () => {
    const html = row();
    expect(html).toContain("<li");
    expect(html).toContain('data-zerops-environment-row="true"');
    expect(html).toContain('data-zerops-surface="environment-name"');
    expect(html).toContain("Acme Docs - stage");
    expect(html).toContain('data-zerops-surface="role-tag"');
    expect(html).toContain(">stage<");
    expect(html).toContain('data-zerops-surface="environment-summary"');
    expect(html).toContain("app, db · deployed 2h ago");
    expect(html.indexOf("Acme Docs - stage")).toBeLessThan(html.indexOf(">stage<"));
    expect(html.indexOf(">stage<")).toBeLessThan(html.indexOf("app, db"));
    expect(html).not.toContain("—");
    expect(html).not.toContain('role="row"');
    expect(html).not.toContain("<button");
  });

  it("has no pill for an environment with no role, and leaves the place empty while its services are unread", () => {
    const html = row({ summary: undefined, tag: null });
    expect(html).not.toContain("role-tag");
    expect(html).toContain('data-zerops-surface="environment-summary"');
    expect(html).not.toContain("No services");
  });

  it("renders the project's trouble, menu and primary action in order", () => {
    const html = row({
      action: <button data-test="verb" type="button" />,
      menu: <span data-test="menu" />,
      status: <span data-test="status" />,
    });
    expect(html).toContain('data-test="status"');
    expect(html).toContain('data-test="verb"');
    expect(html).toContain('data-test="menu"');
    expect(html.indexOf('data-test="status"')).toBeLessThan(html.indexOf('data-test="menu"'));
    expect(html.indexOf('data-test="menu"')).toBeLessThan(html.indexOf('data-test="verb"'));
  });

  it("opens its stop from the name alone when it links there; a plain name otherwise", () => {
    const linked = row({
      action: <button data-test="verb" type="button" />,
      link: { groupId: "aaa", projectId: "fixture-stage" },
      menu: <span data-test="menu" />,
    });
    const anchor = linked.slice(linked.indexOf("<a"), linked.indexOf("</a>") + 4);
    expect(anchor).toContain('href="/group/aaa/fixture-stage"');
    expect(anchor).toContain('data-zerops-surface="environment-name"');
    expect(anchor).toContain(">Acme Docs - stage</a>");
    expect(anchor).not.toContain("role-tag");
    expect(anchor).not.toContain("data-test=");
    expect(linked.match(/<a /gu)).toHaveLength(1);

    const plain = row();
    expect(plain).not.toContain("<a");
    expect(plain).toContain('data-zerops-surface="environment-name">Acme Docs - stage</span>');
  });

  it("says when it is busy", () => {
    expect(row({ busy: true })).toContain('aria-busy="true"');
  });
});

describe("stopLinkOf", () => {
  it.each([
    ["a production of a group", "aaa", "prod", { groupId: "aaa", projectId: "p1" }],
    ["a stage of a group", "aaa", "stage", { groupId: "aaa", projectId: "p1" }],
    ["a dev box of a group", "aaa", "dev", undefined],
    ["a dev/stage of a group", "aaa", "devstage", undefined],
    ["an environment with no role", "aaa", undefined, undefined],
    ["a production no group holds", undefined, "prod", undefined],
  ] as const)("links %s: %j", (_name, groupId, role, link) => {
    expect(stopLinkOf(groupId, "p1", role)).toEqual(link);
  });
});

describe("ZeropsRoleTag", () => {
  it("names the environment role", () => {
    const html = renderToStaticMarkup(<ZeropsRoleTag label="prod" />);
    expect(html).toContain('data-zerops-surface="role-tag"');
    expect(html).toContain(">prod<");
  });
});
