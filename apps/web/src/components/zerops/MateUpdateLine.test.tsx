import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateUpdateLine } from "./MateUpdateLine";

describe("MateUpdateLine", () => {
  it("renders the installed version plainly when there is no update to call out", () => {
    const html = renderToStaticMarkup(
      <MateUpdateLine line={{ text: "Server 0.8.0", tone: "default" }} />,
    );
    expect(html).toContain("Server 0.8.0");
    expect(html).not.toContain("mate-update-attention");
  });

  it("puts only the '· x.y.z available' clause in the attention tone", () => {
    const html = renderToStaticMarkup(
      <MateUpdateLine line={{ text: "Server 0.8.0 · 0.8.1 available", tone: "attention" }} />,
    );
    expect(html).toContain("Server 0.8.0");
    expect(html).toContain('data-zerops-surface="mate-update-attention"');
    expect(html).toContain("0.8.1 available");
    // The attention span wraps only the suffix, not the base text.
    const attentionIndex = html.indexOf("mate-update-attention");
    const baseIndex = html.indexOf("Server 0.8.0");
    expect(baseIndex).toBeLessThan(attentionIndex);
  });

  it("renders the caller's verb after the line", () => {
    const html = renderToStaticMarkup(
      <MateUpdateLine
        line={{ text: "Server 0.8.0", tone: "default" }}
        verb={<button type="button">Update</button>}
      />,
    );
    expect(html).toContain(">Update<");
  });
});
