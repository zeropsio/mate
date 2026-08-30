import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MicroLabel } from "./MicroLabel";

describe("MicroLabel", () => {
  it("renders its phrase through the shared type tokens", () => {
    const label = "Services";
    const html = renderToStaticMarkup(<MicroLabel>{label}</MicroLabel>);

    expect(html).toContain('data-zerops-primitive="micro-label"');
    expect(html).toContain("text-[length:var(--zerops-micro-label-font-size)]");
    expect(html).toContain("[font-weight:var(--zerops-micro-label-font-weight)]");
    expect(html).toContain("tracking-[var(--zerops-micro-label-tracking)]");
    expect(html).toContain("opacity-[var(--zerops-micro-label-opacity)]");
    expect(html).toContain("uppercase");
    expect(html).toContain(label);
  });
});
