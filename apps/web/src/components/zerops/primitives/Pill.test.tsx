import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Pill } from "./Pill";

describe("Pill", () => {
  it.each([
    ["primary", "Deploy"],
    ["secondary", "Cancel"],
  ] as const)("renders the %s CTA phrase with native semantics", (tone, label) => {
    const html = renderToStaticMarkup(<Pill aria-label={label} label={label} tone={tone} />);

    expect(html.startsWith("<button")).toBe(true);
    expect(html).toContain('type="button"');
    expect(html).toContain(`data-zerops-pill-tone="${tone}"`);
    expect(html).toContain(`aria-label="${label}"`);
    expect(html.endsWith(`>${label}</button>`)).toBe(true);
  });

  it("forwards the native disabled state", () => {
    expect(renderToStaticMarkup(<Pill disabled label="Deploy" />)).toContain('disabled=""');
  });
});
