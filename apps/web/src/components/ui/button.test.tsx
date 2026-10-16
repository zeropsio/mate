import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "./button";

describe("Button", () => {
  it.each([
    ["primary", "Deploy"],
    ["secondary", "Cancel"],
  ] as const)("renders the %s CTA phrase with native semantics", (variant, label) => {
    const html = renderToStaticMarkup(
      <Button aria-label={label} variant={variant}>
        {label}
      </Button>,
    );

    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain('type="button"');
    expect(html).toContain(`aria-label="${label}"`);
    expect(html.endsWith(`>${label}</button>`)).toBe(true);
  });

  it("forwards the native disabled state", () => {
    expect(renderToStaticMarkup(<Button disabled>Deploy</Button>)).toMatch(/\sdisabled=""/u);
  });
});
