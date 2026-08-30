import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProcessSteps } from "./ProcessSteps";

const STATES = [
  ["queued", "off", "Waiting to start", "Clock", "clock", "border-[var(--zerops-status-off)]"],
  ["running", "busy", "Deploying", "Play", "play", "border-[var(--zerops-status-busy)]"],
  ["done", "ok", "Complete", "Check", "check", "border-[var(--zerops-status-ok)]"],
  [
    "failed",
    "failed",
    "Deploy failed",
    "CircleAlert",
    "circle-alert",
    "border-[var(--zerops-status-failed)]",
  ],
] as const;

describe("ProcessSteps", () => {
  it.each(STATES)(
    "renders a %s step through the %s status class and consumer phrase",
    (state, tone, stateLabel, iconIntent, iconClass, borderClass) => {
      const html = renderToStaticMarkup(
        <ProcessSteps
          aria-label="Deploy progress"
          steps={[{ id: state, label: "Deploy", state, stateLabel }]}
        />,
      );

      expect(html).toContain('aria-label="Deploy progress"');
      expect(html).toContain(`data-zerops-process-state="${state}"`);
      expect(html).toContain(`data-zerops-process-tone="${tone}"`);
      expect(html).toContain("grid-cols-[var(--zerops-process-step-column)_1fr]");
      expect(html).toContain("size-[var(--zerops-process-step-glyph-size)]");
      expect(html).toContain("border-[length:var(--zerops-process-step-border-width)]");
      expect(html).toContain(borderClass);
      expect(html).toContain(`data-zerops-process-icon="${iconIntent}"`);
      expect(html).toContain(`lucide-${iconClass}`);
      expect(html).toContain(">Deploy</span>");
      expect(html).toContain(`>${stateLabel}</span>`);
    },
  );

  it("uses reduced-motion-safe stepped motion only for the running glyph", () => {
    const running = renderToStaticMarkup(
      <ProcessSteps
        steps={[{ id: "run", label: "Deploy", state: "running", stateLabel: "Deploying" }]}
      />,
    );
    const done = renderToStaticMarkup(
      <ProcessSteps
        steps={[{ id: "done", label: "Deploy", state: "done", stateLabel: "Complete" }]}
      />,
    );

    expect(running).toContain("animate-status-pulse");
    expect(running).toContain("motion-reduce:animate-none");
    expect(done).not.toContain("animate-status-pulse");
  });
});
