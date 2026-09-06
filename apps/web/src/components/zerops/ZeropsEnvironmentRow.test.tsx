import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsEnvironmentRow, ZeropsRoleTag } from "./ZeropsEnvironmentRow";

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
    // The same three places down the page: a grid, not a table, and no dashes.
    expect(html).toContain("grid");
    expect(html).not.toContain("—");
    expect(html).not.toContain('role="row"');
    expect(html).not.toContain("<button");
  });

  it("drops what it holds under the name on a phone", () => {
    const html = row();
    const summaryAt = html.indexOf('data-zerops-surface="environment-summary"');
    const summary = html.slice(html.lastIndexOf("<span", summaryAt), summaryAt);
    expect(summary).toContain("col-span-2");
    expect(summary).toContain("sm:col-span-1");
  });

  it("has no pill for an environment with no role, and leaves the place empty while its services are unread", () => {
    const html = row({ summary: undefined, tag: null });
    expect(html).not.toContain("role-tag");
    expect(html).toContain('data-zerops-surface="environment-summary"');
    expect(html).not.toContain("No services");
  });

  it("puts the project's trouble, the one verb and the menu at the far end, the menu on hover", () => {
    const html = row({
      action: <button data-test="verb" type="button" />,
      menu: <span data-test="menu" />,
      status: <span data-test="status" />,
    });
    const end = html.slice(html.indexOf("justify-end"));
    expect(end).toContain('data-test="status"');
    expect(end).toContain('data-test="verb"');
    expect(end).toContain('data-test="menu"');
    expect(end.indexOf('data-test="status"')).toBeLessThan(end.indexOf('data-test="verb"'));
    expect(end.indexOf('data-test="verb"')).toBeLessThan(end.indexOf('data-test="menu"'));
    expect(html).toContain("group-hover/row:opacity-100");
  });

  it("says when it is busy", () => {
    expect(row({ busy: true })).toContain('aria-busy="true"');
  });
});

describe("ZeropsRoleTag", () => {
  it("is the one MicroLabel in a pill", () => {
    const html = renderToStaticMarkup(<ZeropsRoleTag label="prod" />);
    expect(html).toContain('data-zerops-surface="role-tag"');
    expect(html).toContain('data-zerops-primitive="micro-label"');
    expect(html).toContain("rounded-full");
    expect(html).toContain(">prod<");
  });
});
