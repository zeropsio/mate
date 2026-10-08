import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { StatusDot } from "./StatusDot";

const TONES = [
  ["ok", "Ready"],
  ["busy", "Creating"],
  ["attention", "Action required"],
  ["failed", "Deploy failed"],
  ["off", "Stopped"],
] as const;

describe("StatusDot", () => {
  it.each(TONES)("renders the %s state with a visible phrase", (tone, label) => {
    const html = renderToStaticMarkup(<StatusDot label={label} tone={tone} />);

    expect(html).toContain(`data-zerops-status-tone="${tone}"`);
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.endsWith(`>${label}</span></span>`)).toBe(true);
  });

  it("can be the dot alone, the word kept as its name and never as a native title", () => {
    const html = renderToStaticMarkup(<StatusDot dotOnly label="Deployed" tone="ok" />);
    expect(html).toContain('aria-label="Deployed"');
    expect(html).not.toContain("title=");
    expect(html).toContain('role="img"');
    expect(html).not.toContain(">Deployed</span>");
    expect(html).toContain('data-zerops-status-tone="ok"');
  });

  it("can set the phrase as a sentence instead of a label", () => {
    const html = renderToStaticMarkup(
      <StatusDot label="Setting up infrastructure" sentence tone="busy" />,
    );

    expect(html).toContain(">Setting up infrastructure</span>");
  });
});
