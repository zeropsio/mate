import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsEnvironmentRow, ZeropsRoleTag } from "./ZeropsEnvironmentRow";

function row(props: Partial<React.ComponentProps<typeof ZeropsEnvironmentRow>> = {}) {
  return renderToStaticMarkup(
    <ul>
      <ZeropsEnvironmentRow name="Acme Docs - stage" tag="stage" {...props} />
    </ul>,
  );
}

describe("ZeropsEnvironmentRow", () => {
  it("is a row of a list: the name, its tag as a pill trailing it, and nothing else when there is nothing to say", () => {
    const html = row();
    expect(html).toContain("<li");
    expect(html).toContain('data-zerops-environment-row="true"');
    expect(html).toContain('data-zerops-surface="environment-name"');
    expect(html).toContain("Acme Docs - stage");
    expect(html).toContain('data-zerops-surface="role-tag"');
    expect(html).toContain(">stage<");
    expect(html.indexOf("Acme Docs - stage")).toBeLessThan(html.indexOf(">stage<"));
    // No empty columns, no dashes, no table.
    expect(html).not.toContain("—");
    expect(html).not.toContain('role="row"');
    expect(html).not.toContain("<button");
  });

  it("has no pill for an environment with no role", () => {
    expect(row({ tag: null })).not.toContain("role-tag");
  });

  it("puts the project's trouble, the one verb and the menu at the far end, the menu on hover", () => {
    const html = row({
      action: <button data-test="verb" type="button" />,
      menu: <span data-test="menu" />,
      status: <span data-test="status" />,
    });
    const end = html.slice(html.indexOf("ms-auto"));
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
