import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Input } from "./input";

describe("Input", () => {
  it("a secret is drawn hidden, and no browser or password manager offers to save it", () => {
    const html = renderToStaticMarkup(<Input defaultValue="sk-acme" type="password" />);
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="password"');
    expect(html).toContain("-webkit-text-security:disc");
    expect(html).toMatch(/autocomplete="off"/iu);
    expect(html).toContain('data-1p-ignore=""');
    expect(html).toContain('data-lpignore="true"');
    expect(html).toContain('data-bwignore=""');
  });

  it("a shown secret is plain text", () => {
    const html = renderToStaticMarkup(<Input defaultValue="sk-acme" type="text" />);
    expect(html).not.toContain("-webkit-text-security");
    expect(html).not.toContain("data-1p-ignore");
  });
});
