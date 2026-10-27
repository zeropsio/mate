import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateUpdateLine } from "./MateUpdateLine";

describe("MateUpdateLine", () => {
  it("renders the installed version plainly when there is no update to call out", () => {
    const html = renderToStaticMarkup(
      <MateUpdateLine line={{ text: "Server 0.8.0", tone: "default" }} />,
    );
    expect(html).toContain("Server 0.8.0");
    expect(html).not.toContain("mate-update-role");
  });

  it("puts only the '· x.y.z available' clause in the glossary's update role (teal)", () => {
    const html = renderToStaticMarkup(
      <MateUpdateLine line={{ text: "Server 0.8.0 · 0.8.1 available", tone: "attention" }} />,
    );
    expect(html).toContain("Server 0.8.0");
    expect(html).toContain('data-zerops-surface="mate-update-role"');
    expect(html).toContain("--zerops-update-role");
    expect(html).toContain("0.8.1 available");
    // The update-role span wraps only the suffix, not the base text.
    const roleIndex = html.indexOf("mate-update-role");
    const baseIndex = html.indexOf("Server 0.8.0");
    expect(baseIndex).toBeLessThan(roleIndex);
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
