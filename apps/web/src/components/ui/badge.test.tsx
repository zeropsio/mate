import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Badge } from "./badge";

describe("badge variants", () => {
  it("adds chip geometry without changing the default", () => {
    const chip = renderToStaticMarkup(<Badge variant="chip">Full access</Badge>);
    const defaultBadge = renderToStaticMarkup(<Badge>Default</Badge>);

    expect(chip).toContain("rounded-[var(--zerops-chip-radius)]");
    expect(chip).toContain("bg-muted");
    expect(chip).toContain("text-foreground");
    expect(defaultBadge).toContain("bg-primary");
    expect(defaultBadge).not.toContain("rounded-[var(--zerops-chip-radius)]");
  });
});
