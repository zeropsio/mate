import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { formatStepDuration, ProcessSteps } from "./ProcessSteps";

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

  it("renders an optional note in muted text after the label", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps
        steps={[
          {
            id: "provision",
            label: "Provision",
            state: "done",
            stateLabel: "Done",
            note: "weatherdash created",
          },
        ]}
      />,
    );

    expect(html).toContain(">Provision<");
    expect(html).toContain("weatherdash created");
  });

  it("omits the note span entirely when no note is given", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps
        steps={[{ id: "deploy", label: "Deploy", state: "done", stateLabel: "Done" }]}
      />,
    );

    expect(html).toContain(">Deploy</span>");
  });

  it("right-aligns a formatted duration in tabular nums when durationMs is given", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps
        steps={[
          { id: "build", label: "Build", state: "done", stateLabel: "Done", durationMs: 4_000 },
        ]}
      />,
    );

    expect(html).toContain("4 s");
    expect(html).toContain("tabular-nums");
  });

  it("omits the duration span entirely when no durationMs is given", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps
        steps={[{ id: "deploy", label: "Deploy", state: "done", stateLabel: "Done" }]}
      />,
    );

    expect(html).not.toContain("tabular-nums");
  });
});

describe("formatStepDuration", () => {
  it.each([
    [4_000, "4 s"],
    [59_000, "59 s"],
    [72_000, "1m 12s"],
    [60_000, "1m"],
    [0, "0 s"],
  ])("formats %ims as %s", (durationMs, expected) => {
    expect(formatStepDuration(durationMs)).toBe(expected);
  });
});
