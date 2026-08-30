import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MintPanel } from "./MintPanel";

describe("MintPanel", () => {
  it("contains consumer-owned content", () => {
    const label = "Infrastructure";
    const html = renderToStaticMarkup(<MintPanel aria-label={label}>{label}</MintPanel>);

    expect(html).toContain('data-zerops-primitive="mint-panel"');
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain("bg-[var(--zerops-mint-panel)]");
    expect(html).toContain("rounded-[var(--zerops-card-radius)]");
    expect(html).toContain(label);
  });
});
