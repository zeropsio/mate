import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { StatusDot } from "./StatusDot";

const TONES = [
  ["ok", "Ready", "bg-[var(--zerops-status-ok)]"],
  ["busy", "Creating", "bg-[var(--zerops-status-busy)]"],
  ["attention", "Action required", "bg-[var(--zerops-status-attention)]"],
  ["failed", "Deploy failed", "bg-[var(--zerops-status-failed)]"],
  ["off", "Stopped", "bg-[var(--zerops-status-off)]"],
] as const;

describe("StatusDot", () => {
  it.each(TONES)("renders the %s dot class with a visible phrase", (tone, label, dotClass) => {
    const html = renderToStaticMarkup(<StatusDot label={label} tone={tone} />);

    expect(html).toContain(`data-zerops-status-tone="${tone}"`);
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(dotClass);
    expect(html.endsWith(`>${label}</span></span>`)).toBe(true);
  });

  it("uses the stepped hook for busy work and exposes reduced motion", () => {
    const pulsing = renderToStaticMarkup(<StatusDot label="Creating" tone="busy" />);
    const settled = renderToStaticMarkup(
      <StatusDot label="Ready to deploy" pulse={false} tone="busy" />,
    );

    expect(pulsing).toContain("animate-status-pulse");
    expect(pulsing).toContain("motion-reduce:animate-none");
    expect(settled).not.toContain("animate-status-pulse");
  });
});
