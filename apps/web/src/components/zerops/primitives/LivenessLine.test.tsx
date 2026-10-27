import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { LivenessLine } from "./LivenessLine";

const STATES = [
  ["live", "ok", "Live · updated just now"],
  ["recovering", "busy", "Connecting live updates"],
  ["doorbell-down", "off", "Live updates unavailable"],
  ["last-read-failed", "failed", "Last read failed · retrying"],
] as const;

describe("LivenessLine", () => {
  it.each(STATES)("renders %s as a phrased %s state", (state, tone, label) => {
    const html = renderToStaticMarkup(<LivenessLine label={label} state={state} />);

    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-live");
    expect(html).toContain(`data-zerops-liveness="${state}"`);
    expect(html).toContain(`data-zerops-liveness-tone="${tone}"`);
    expect(html.endsWith(`>${label}</span></span></span>`)).toBe(true);
  });

  it("renders nothing for the absent state", () => {
    expect(renderToStaticMarkup(<LivenessLine state="absent" />)).toBe("");
  });
});
