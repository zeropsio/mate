import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MicroLabel } from "./MicroLabel";

describe("MicroLabel", () => {
  it("renders its consumer phrase", () => {
    const label = "Services";
    const html = renderToStaticMarkup(<MicroLabel>{label}</MicroLabel>);

    expect(html).toContain('data-zerops-primitive="micro-label"');
    expect(html).toContain(label);
  });
});
