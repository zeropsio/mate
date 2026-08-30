import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { FlatCard } from "./FlatCard";

describe("FlatCard", () => {
  it("renders a passive card with no shadow", () => {
    const label = "Service";
    const html = renderToStaticMarkup(<FlatCard aria-label={label}>{label}</FlatCard>);

    expect(html.startsWith("<div")).toBe(true);
    expect(html).toContain('data-zerops-primitive="flat-card"');
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain("rounded-[var(--zerops-card-radius)]");
    expect(html).toContain("border-[var(--zerops-flat-card-border)]");
    expect(html).not.toContain("shadow");
  });
});
