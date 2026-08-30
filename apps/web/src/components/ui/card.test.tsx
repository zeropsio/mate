import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Card } from "./card";

describe("card variants", () => {
  it("adds the flat semantic-token variant", () => {
    const html = renderToStaticMarkup(<Card variant="flat">Flat</Card>);

    expect(html).toContain("rounded-[var(--zerops-card-radius)]");
    expect(html).toContain("border-[var(--zerops-flat-card-border)]");
    expect(html).not.toContain("shadow");
  });

  it("keeps the existing raised card as the default", () => {
    const html = renderToStaticMarkup(<Card>Default</Card>);

    expect(html).toContain("rounded-2xl");
    expect(html).toContain("shadow-xs/5");
    expect(html).not.toContain("border-[var(--zerops-flat-card-border)]");
  });
});
