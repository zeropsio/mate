import { markupDom } from "../../../../test/markupDom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { formatStepDuration, ProcessSteps } from "./ProcessSteps";

const STATES = [
  ["queued", "off", "Waiting to start", "Clock"],
  ["running", "busy", "Deploying", "Play"],
  ["done", "ok", "Complete", "Check"],
  ["failed", "failed", "Deploy failed", "CircleAlert"],
] as const;

describe("ProcessSteps", () => {
  it.each(STATES)(
    "renders a %s step with its %s state and consumer phrase",
    (state, tone, stateLabel, iconIntent) => {
      const html = renderToStaticMarkup(
        <ProcessSteps
          aria-label="Deploy progress"
          steps={[{ id: state, label: "Deploy", state, stateLabel }]}
        />,
      );

      expect(html).toContain('aria-label="Deploy progress"');
      expect(html).toContain(`data-zerops-process-state="${state}"`);
      expect(html).toContain(`data-zerops-process-tone="${tone}"`);

      expect(html).toContain(`data-zerops-process-icon="${iconIntent}"`);

      expect(html).toContain(">Deploy</span>");
      expect(html).toContain(`>${stateLabel}</span>`);
    },
  );

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

  it.each(["default", "compact"] as const)(
    "shows no duration when none was reported (%s)",
    (density) => {
      const document = markupDom(
        renderToStaticMarkup(
          <ProcessSteps
            density={density}
            steps={[{ id: "deploy", label: "Deploy", state: "done", stateLabel: "Done" }]}
          />,
        ),
      );
      expect(document.querySelector("li")?.textContent).toBe("Deploy");
    },
  );

  it("shows a formatted duration when durationMs is given", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps
        steps={[
          { id: "build", label: "Build", state: "done", stateLabel: "Done", durationMs: 4_000 },
        ]}
      />,
    );

    expect(html).toContain("4s");
  });
});

describe("formatStepDuration", () => {
  it.each([
    [4_000, "4s"],
    [59_000, "59s"],
    [72_000, "1m 12s"],
    [60_000, "1m"],
    [0, "0s"],
  ])("formats %ims as %s", (durationMs, expected) => {
    expect(formatStepDuration(durationMs)).toBe(expected);
  });
});

describe("ProcessSteps — redundant step state words", () => {
  it("hides the stateLabel when it only repeats what the glyph already says (Done, Waiting)", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps
        steps={[
          { id: "a", label: "Discover", state: "done", stateLabel: "Done" },
          { id: "b", label: "Provision", state: "queued", stateLabel: "Waiting" },
        ]}
      />,
    );

    expect(html).not.toContain(">Done<");
    expect(html).not.toContain(">Waiting<");
  });

  it("keeps the stateLabel for Running, Failed, Skipped, and any other word", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps
        steps={[
          { id: "a", label: "Build", state: "running", stateLabel: "Running" },
          { id: "b", label: "Deploy", state: "failed", stateLabel: "Failed" },
          { id: "c", label: "Close", state: "done", stateLabel: "Skipped" },
          { id: "d", label: "Custom", state: "queued", stateLabel: "Pending review" },
        ]}
      />,
    );

    expect(html).toContain(">Running<");
    expect(html).toContain(">Failed<");
    expect(html).toContain(">Skipped<");
    expect(html).toContain(">Pending review<");
  });
});

describe("ProcessSteps — compact density", () => {
  it.each(STATES)(
    "sets a %s step as a bare glyph with its state inline, not a ringed row",
    (state, tone, stateLabel) => {
      const html = renderToStaticMarkup(
        <ProcessSteps
          density="compact"
          steps={[{ id: state, label: "Deploy", state, stateLabel }]}
        />,
      );

      expect(html).toContain(`data-zerops-process-state="${state}"`);
      expect(html).toContain(`data-zerops-process-tone="${tone}"`);
      // Every step list's marks: a ring whose inside says the state.
      expect(html).toContain(
        `data-step-glyph="${{ queued: "waiting", running: "running", done: "done", failed: "failed" }[state]}"`,
      );
      expect(html).toContain('data-zerops-process-density="compact"');

      // The state is read in the same line as the label, in the running hand.
      expect(html).not.toContain('data-zerops-primitive="micro-label"');
      expect(html).toContain(`>${stateLabel}</span>`);
    },
  );

  it("keeps the ringed default for process timelines", () => {
    const html = renderToStaticMarkup(
      <ProcessSteps steps={[{ id: "d", label: "Deploy", state: "done", stateLabel: "Done" }]} />,
    );
    expect(html).toContain('data-zerops-process-density="default"');
  });
});
