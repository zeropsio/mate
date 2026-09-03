import { describe, expect, it } from "vite-plus/test";

import { observedSteps } from "./observedSteps.ts";

const NOW = Date.parse("2026-09-02T10:10:00.000Z");

describe("observedSteps — pipeline steps with per-step durations", () => {
  it("no appVersion — every step noop, so the list is empty", () => {
    expect(observedSteps(undefined, NOW)).toEqual([]);
  });

  it("waiting to build, no pipeline start — every step queued, no timestamps", () => {
    const steps = observedSteps({ status: "WAITING_TO_BUILD" }, NOW);
    expect(steps).toEqual([
      {
        id: "INIT_BUILD_CONTAINER",
        label: "Build container",
        state: "queued",
        stateLabel: "Queued",
      },
      { id: "RUN_BUILD_COMMANDS", label: "Build", state: "queued", stateLabel: "Queued" },
      {
        id: "INIT_PREPARE_CONTAINER",
        label: "Prepare container",
        state: "queued",
        stateLabel: "Queued",
      },
      {
        id: "RUN_PREPARE_COMMANDS",
        label: "Prepare runtime",
        state: "queued",
        stateLabel: "Queued",
      },
      { id: "DEPLOY", label: "Deploy", state: "queued", stateLabel: "Queued" },
    ]);
  });

  it("init build container running — duration ticks from pipelineStart to now", () => {
    const steps = observedSteps(
      { status: "WAITING_TO_BUILD", build: { pipelineStart: "2026-09-02T10:09:30.000Z" } },
      NOW,
    );
    const initStep = steps.find((step) => step.id === "INIT_BUILD_CONTAINER");
    expect(initStep).toMatchObject({
      state: "running",
      stateLabel: "Running",
      startedAt: "2026-09-02T10:09:30.000Z",
      durationMs: 30_000,
    });
    expect(initStep?.endedAt).toBeUndefined();
  });

  it("build commands finished — duration is startDate to endDate, not a live tick", () => {
    const steps = observedSteps(
      {
        status: "PREPARING_RUNTIME",
        build: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-09-02T10:01:00.000Z" },
      },
      NOW,
    );
    const buildStep = steps.find((step) => step.id === "RUN_BUILD_COMMANDS");
    expect(buildStep).toMatchObject({
      state: "done",
      stateLabel: "Done",
      startedAt: "2026-09-02T10:00:00.000Z",
      endedAt: "2026-09-02T10:01:00.000Z",
      durationMs: 60_000,
    });
  });

  it("init prepare container uses build.endDate as its start when present", () => {
    const steps = observedSteps(
      {
        status: "PREPARING_RUNTIME",
        build: { startDate: "2026-09-02T10:00:00.000Z", endDate: "2026-09-02T10:01:00.000Z" },
        prepareCustomRuntime: { startDate: "2026-09-02T10:01:10.000Z" },
      },
      NOW,
    );
    const initPrepare = steps.find((step) => step.id === "INIT_PREPARE_CONTAINER");
    expect(initPrepare).toMatchObject({
      startedAt: "2026-09-02T10:01:00.000Z",
      endedAt: "2026-09-02T10:01:10.000Z",
    });
  });

  it("init prepare container falls back to pipelineStart when there is no build.endDate", () => {
    const steps = observedSteps(
      {
        status: "PREPARING_RUNTIME",
        build: { pipelineStart: "2026-09-02T09:59:00.000Z" },
        prepareCustomRuntime: { startDate: "2026-09-02T10:01:10.000Z" },
      },
      NOW,
    );
    const initPrepare = steps.find((step) => step.id === "INIT_PREPARE_CONTAINER");
    expect(initPrepare?.startedAt).toBe("2026-09-02T09:59:00.000Z");
  });

  it("deploy step's end prefers activationDate over build.pipelineFinish", () => {
    const steps = observedSteps(
      {
        status: "DEPLOYING",
        build: {
          startDate: "2026-09-02T10:00:00.000Z",
          endDate: "2026-09-02T10:01:00.000Z",
          pipelineFinish: "2026-09-02T10:05:00.000Z",
        },
        activationDate: "2026-09-02T10:04:00.000Z",
      },
      NOW,
    );
    const deploy = steps.find((step) => step.id === "DEPLOY");
    expect(deploy).toMatchObject({
      state: "running",
      startedAt: "2026-09-02T10:01:00.000Z",
      endedAt: "2026-09-02T10:04:00.000Z",
      durationMs: 3 * 60_000,
    });
  });

  it("deploy step falls back to build.pipelineFinish with no activationDate", () => {
    const steps = observedSteps(
      {
        status: "ACTIVE",
        build: {
          startDate: "2026-09-02T10:00:00.000Z",
          endDate: "2026-09-02T10:01:00.000Z",
          pipelineFinish: "2026-09-02T10:05:00.000Z",
        },
      },
      NOW,
    );
    const deploy = steps.find((step) => step.id === "DEPLOY");
    expect(deploy?.endedAt).toBe("2026-09-02T10:05:00.000Z");
  });

  it("deploying with an activationDate — activating maps to running", () => {
    const steps = observedSteps({ status: "DEPLOYING", activationDate: "t6" }, NOW);
    const deploy = steps.find((step) => step.id === "DEPLOY");
    expect(deploy).toMatchObject({ state: "running", stateLabel: "Activating" });
  });

  it("cancelled before any build ran — every step failed with stateLabel Cancelled", () => {
    const steps = observedSteps({ status: "CANCELLED", build: { pipelineFailed: "t9" } }, NOW);
    expect(steps).toHaveLength(5);
    for (const step of steps) {
      expect(step.state).toBe("failed");
      expect(step.stateLabel).toBe("Cancelled");
    }
  });

  it("build failed after the build started — later steps are cancelled, not failed", () => {
    const steps = observedSteps(
      { status: "BUILD_FAILED", build: { startDate: "2026-09-02T10:00:00.000Z" } },
      NOW,
    );
    expect(steps.find((step) => step.id === "RUN_BUILD_COMMANDS")).toMatchObject({
      state: "failed",
      stateLabel: "Failed",
    });
    expect(steps.find((step) => step.id === "INIT_PREPARE_CONTAINER")).toMatchObject({
      state: "failed",
      stateLabel: "Cancelled",
    });
  });

  it("active with no build/prepare (start-without-code) — noop steps are omitted, only DEPLOY remains", () => {
    const steps = observedSteps({ status: "ACTIVE" }, NOW);
    expect(steps).toEqual([{ id: "DEPLOY", label: "Deploy", state: "done", stateLabel: "Done" }]);
  });

  it("missing timestamps mean no duration, even mid-run", () => {
    const steps = observedSteps({ status: "BUILDING" }, NOW);
    const initStep = steps.find((step) => step.id === "INIT_BUILD_CONTAINER");
    expect(initStep?.durationMs).toBeUndefined();
    expect(initStep?.startedAt).toBeUndefined();
  });
});
