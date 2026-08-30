import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { LivenessLine } from "./LivenessLine";

const STATES = [
  ["live", "ok", "Live · updated just now", "bg-[var(--zerops-status-ok)]"],
  ["polling", "busy", "Polling", "bg-[var(--zerops-status-busy)]"],
  ["doorbell-down", "off", "Live updates unavailable", "bg-[var(--zerops-status-off)]"],
  ["last-read-failed", "failed", "Last read failed · retrying", "bg-[var(--zerops-status-failed)]"],
] as const;

describe("LivenessLine", () => {
  it.each(STATES)("renders %s as a phrased %s state", (state, tone, label, dotClass) => {
    const html = renderToStaticMarkup(<LivenessLine label={label} state={state} />);

    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-live");
    expect(html).toContain(`data-zerops-liveness="${state}"`);
    expect(html).toContain(`data-zerops-liveness-tone="${tone}"`);
    expect(html).toContain(dotClass);
    expect(html.endsWith(`>${label}</span></span></span>`)).toBe(true);
  });

  it("renders nothing for the absent state", () => {
    expect(renderToStaticMarkup(<LivenessLine state="absent" />)).toBe("");
  });
});
