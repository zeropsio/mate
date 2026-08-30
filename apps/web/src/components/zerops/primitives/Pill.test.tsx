import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Pill } from "./Pill";

describe("Pill", () => {
  it.each([
    ["primary", "Deploy", "border-primary bg-primary text-primary-foreground"],
    ["secondary", "Cancel", "border-transparent bg-secondary text-secondary-foreground"],
  ] as const)(
    "renders the %s CTA class and phrase with native semantics",
    (tone, label, classes) => {
      const html = renderToStaticMarkup(<Pill aria-label={label} label={label} tone={tone} />);

      expect(html.startsWith("<button")).toBe(true);
      expect(html).toContain('type="button"');
      expect(html).toContain(`data-zerops-pill-tone="${tone}"`);
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain("rounded-[var(--zerops-pill-radius)]");
      expect(html).toContain(classes);
      expect(html.endsWith(`>${label}</button>`)).toBe(true);
    },
  );

  it("forwards the native disabled state", () => {
    expect(renderToStaticMarkup(<Pill disabled label="Deploy" />)).toContain('disabled=""');
  });
});
