import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { BirthProgress, BirthStep } from "@t3tools/client-runtime/zerops/birthProgress";

import { ZeropsBirthChecklist, ZeropsBirthLine } from "./ZeropsBirthProgress";

function step(partial: Partial<BirthStep> & Pick<BirthStep, "id" | "state">): BirthStep {
  return { label: "Container", ...partial };
}

const SIX_STEPS: ReadonlyArray<BirthStep> = [
  step({ id: "project", label: "Project", state: "done" }),
  step({ id: "container", label: "Container", state: "active", detail: "Building the container" }),
  step({ id: "public-access", label: "Public access", state: "waiting" }),
  step({ id: "hardening", label: "Closing off", state: "waiting" }),
  step({ id: "mate", label: "Zerops Mate", state: "waiting" }),
  step({ id: "connect", label: "Opening", state: "waiting" }),
];

function progress(partial: Partial<BirthProgress> = {}): BirthProgress {
  return {
    steps: SIX_STEPS,
    active: SIX_STEPS[1]!,
    failed: null,
    doneCount: 1,
    total: 6,
    complete: false,
    startedAt: "2026-09-22T10:00:00Z",
    ...partial,
  };
}

const NOW = Date.parse("2026-09-22T10:01:05Z");

describe("ZeropsBirthLine", () => {
  it("is the meter, the active step's detail, and the elapsed time, in that order", () => {
    const html = renderToStaticMarkup(<ZeropsBirthLine nowMs={NOW} progress={progress()} />);
    expect(html).toContain('data-zerops-surface="birth-line"');
    expect(html.indexOf("progressbar")).toBeLessThan(html.indexOf("Building the container"));
    expect(html.indexOf("Building the container")).toBeLessThan(html.indexOf("1:05"));
  });

  it("draws one segment per step, six for the six-step birth", () => {
    const html = renderToStaticMarkup(<ZeropsBirthLine nowMs={NOW} progress={progress()} />);
    expect(html.match(/data-zerops-birth-step-state=/g)?.length).toBe(6);
  });

  it("the meter is an accessible progressbar naming the active step's detail", () => {
    const html = renderToStaticMarkup(<ZeropsBirthLine nowMs={NOW} progress={progress()} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuemax="6"');
    expect(html).toContain('aria-valuetext="Building the container"');
  });

  it("shows the failed step's detail in the failed tone once one step has failed", () => {
    const failedStep = step({
      id: "container",
      label: "Container",
      state: "failed",
      detail: "Could not be created.",
    });
    const html = renderToStaticMarkup(
      <ZeropsBirthLine
        nowMs={NOW}
        progress={progress({
          active: null,
          failed: failedStep,
          steps: [failedStep, ...SIX_STEPS.slice(1)],
        })}
      />,
    );
    expect(html).toContain("Could not be created.");
    expect(html).toContain("text-[var(--zerops-status-failed-text)]");
  });

  it("says nothing where there is no active or failed step and the birth is still running", () => {
    const html = renderToStaticMarkup(
      <ZeropsBirthLine nowMs={NOW} progress={progress({ active: null, failed: null })} />,
    );
    expect(html).not.toContain("aria-valuetext=");
  });

  it("reads the elapsed time from the birth's own start, not the active step's", () => {
    const html = renderToStaticMarkup(
      <ZeropsBirthLine nowMs={Date.parse("2026-09-22T10:02:30Z")} progress={progress()} />,
    );
    expect(html).toContain("2:30");
  });

  it("shows no elapsed time when the birth's start is unknown", () => {
    const { startedAt: _startedAt, ...withoutStart } = progress();
    const html = renderToStaticMarkup(<ZeropsBirthLine nowMs={NOW} progress={withoutStart} />);
    expect(html).not.toContain("1:05");
  });
});

describe("ZeropsBirthChecklist", () => {
  it("lists every step by its own label", () => {
    const html = renderToStaticMarkup(<ZeropsBirthChecklist nowMs={NOW} progress={progress()} />);
    for (const label of [
      "Project",
      "Container",
      "Public access",
      "Closing off",
      "Zerops Mate",
      "Opening",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("nests the container step's build substeps, indented under it", () => {
    const withSubsteps: BirthStep = {
      ...SIX_STEPS[1]!,
      substeps: [
        { id: "RUN_BUILD_COMMANDS", label: "Build", state: "running", stateLabel: "Running" },
      ],
    };
    const html = renderToStaticMarkup(
      <ZeropsBirthChecklist
        nowMs={NOW}
        progress={progress({ steps: [SIX_STEPS[0]!, withSubsteps, ...SIX_STEPS.slice(2)] })}
      />,
    );
    expect(html).toContain('data-zerops-surface="birth-build-substeps"');
    expect(html.indexOf("Container")).toBeLessThan(html.indexOf("Build"));
  });

  it("carries no substeps block for a step with none", () => {
    const html = renderToStaticMarkup(<ZeropsBirthChecklist nowMs={NOW} progress={progress()} />);
    expect(html).not.toContain('data-zerops-surface="birth-build-substeps"');
  });
});
