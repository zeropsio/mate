import { describe, expect, it } from "vite-plus/test";

import { getPipelineState, pipelineTerminalOutcome } from "./pipelineState.ts";

describe("getPipelineState — table-tested against the FE branches", () => {
  it("has no appVersion — every step noop", () => {
    expect(getPipelineState(undefined)).toEqual({
      INIT_BUILD_CONTAINER: "noop",
      RUN_BUILD_COMMANDS: "noop",
      INIT_PREPARE_CONTAINER: "noop",
      RUN_PREPARE_COMMANDS: "noop",
      DEPLOY: "noop",
    });
  });

  it("waiting to build, no pipeline start — every step waiting", () => {
    expect(getPipelineState({ status: "WAITING_TO_BUILD" })).toEqual({
      INIT_BUILD_CONTAINER: "waiting",
      RUN_BUILD_COMMANDS: "waiting",
      INIT_PREPARE_CONTAINER: "waiting",
      RUN_PREPARE_COMMANDS: "waiting",
      DEPLOY: "waiting",
    });
  });

  it("init build container running (pipeline started, container not up)", () => {
    expect(
      getPipelineState({ status: "WAITING_TO_BUILD", build: { pipelineStart: "t1" } }),
    ).toEqual({
      INIT_BUILD_CONTAINER: "running",
      RUN_BUILD_COMMANDS: "waiting",
      INIT_PREPARE_CONTAINER: "waiting",
      RUN_PREPARE_COMMANDS: "waiting",
      DEPLOY: "waiting",
    });
    expect(getPipelineState({ status: "BUILDING" })).toEqual({
      INIT_BUILD_CONTAINER: "running",
      RUN_BUILD_COMMANDS: "waiting",
      INIT_PREPARE_CONTAINER: "waiting",
      RUN_PREPARE_COMMANDS: "waiting",
      DEPLOY: "waiting",
    });
  });

  it("build commands running", () => {
    expect(getPipelineState({ status: "BUILDING", build: { startDate: "t2" } })).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "running",
      INIT_PREPARE_CONTAINER: "waiting",
      RUN_PREPARE_COMMANDS: "waiting",
      DEPLOY: "waiting",
    });
  });

  it("init prepare container running, once the build ended", () => {
    expect(
      getPipelineState({ status: "PREPARING_RUNTIME", build: { startDate: "t2", endDate: "t3" } }),
    ).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "running",
      RUN_PREPARE_COMMANDS: "waiting",
      DEPLOY: "waiting",
    });
  });

  it("prepare commands running", () => {
    expect(
      getPipelineState({
        status: "PREPARING_RUNTIME",
        build: { startDate: "t2", endDate: "t3" },
        prepareCustomRuntime: { startDate: "t4" },
      }),
    ).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "running",
      DEPLOY: "waiting",
    });
  });

  it("prepare commands finished", () => {
    expect(
      getPipelineState({
        status: "PREPARING_RUNTIME",
        build: { startDate: "t2", endDate: "t3" },
        prepareCustomRuntime: { startDate: "t4", endDate: "t5" },
      }),
    ).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "finished",
      DEPLOY: "waiting",
    });
  });

  it("waiting to deploy", () => {
    expect(getPipelineState({ status: "WAITING_TO_DEPLOY" })).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "finished",
      DEPLOY: "waiting",
    });
  });

  it("deploying, no activation date yet", () => {
    expect(getPipelineState({ status: "DEPLOYING" })).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "finished",
      DEPLOY: "running",
    });
  });

  it("deploying with an activation date — activating", () => {
    expect(getPipelineState({ status: "DEPLOYING", activationDate: "t6" })).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "finished",
      DEPLOY: "activating",
    });
  });

  it("build failed before the build container ever started", () => {
    expect(getPipelineState({ status: "BUILD_FAILED" })).toEqual({
      INIT_BUILD_CONTAINER: "failed",
      RUN_BUILD_COMMANDS: "cancelled",
      INIT_PREPARE_CONTAINER: "cancelled",
      RUN_PREPARE_COMMANDS: "cancelled",
      DEPLOY: "cancelled",
    });
  });

  it("build failed after the build started", () => {
    expect(getPipelineState({ status: "BUILD_FAILED", build: { startDate: "t2" } })).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "failed",
      INIT_PREPARE_CONTAINER: "cancelled",
      RUN_PREPARE_COMMANDS: "cancelled",
      DEPLOY: "cancelled",
    });
  });

  it("prepare failed before the prepare container started", () => {
    expect(getPipelineState({ status: "PREPARING_RUNTIME_FAILED" })).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "failed",
      RUN_PREPARE_COMMANDS: "cancelled",
      DEPLOY: "cancelled",
    });
  });

  it("prepare failed after the prepare container started", () => {
    expect(
      getPipelineState({
        status: "PREPARING_RUNTIME_FAILED",
        prepareCustomRuntime: { startDate: "t4" },
      }),
    ).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "failed",
      DEPLOY: "cancelled",
    });
  });

  it("deploy failed", () => {
    expect(getPipelineState({ status: "DEPLOY_FAILED" })).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "finished",
      DEPLOY: "failed",
    });
  });

  it("active with no build/prepare (start-without-code) — noop, not waiting", () => {
    expect(getPipelineState({ status: "ACTIVE" })).toEqual({
      INIT_BUILD_CONTAINER: "noop",
      RUN_BUILD_COMMANDS: "noop",
      INIT_PREPARE_CONTAINER: "noop",
      RUN_PREPARE_COMMANDS: "noop",
      DEPLOY: "finished",
    });
  });

  it("active/backup with a build and prepare — every earlier step finished", () => {
    expect(
      getPipelineState({
        status: "BACKUP",
        build: { startDate: "t2", endDate: "t3" },
        prepareCustomRuntime: { startDate: "t4", endDate: "t5" },
      }),
    ).toEqual({
      INIT_BUILD_CONTAINER: "finished",
      RUN_BUILD_COMMANDS: "finished",
      INIT_PREPARE_CONTAINER: "finished",
      RUN_PREPARE_COMMANDS: "finished",
      DEPLOY: "finished",
    });
  });

  it("cancelled before any build ran", () => {
    expect(getPipelineState({ status: "CANCELLED", build: { pipelineFailed: "t9" } })).toEqual({
      INIT_BUILD_CONTAINER: "cancelled",
      RUN_BUILD_COMMANDS: "cancelled",
      INIT_PREPARE_CONTAINER: "cancelled",
      RUN_PREPARE_COMMANDS: "cancelled",
      DEPLOY: "cancelled",
    });
  });

  it("an unrecognised status — falls through to noop, not a guess", () => {
    expect(getPipelineState({ status: "SOMETHING_NEW" })).toEqual({
      INIT_BUILD_CONTAINER: "noop",
      RUN_BUILD_COMMANDS: "noop",
      INIT_PREPARE_CONTAINER: "noop",
      RUN_PREPARE_COMMANDS: "noop",
      DEPLOY: "noop",
    });
  });
});

describe("pipelineTerminalOutcome", () => {
  it("reads finished/failed/cancelled off the DEPLOY step", () => {
    expect(pipelineTerminalOutcome(getPipelineState({ status: "ACTIVE" }))).toBe("finished");
    expect(pipelineTerminalOutcome(getPipelineState({ status: "DEPLOY_FAILED" }))).toBe("failed");
    expect(
      pipelineTerminalOutcome(
        getPipelineState({ status: "CANCELLED", build: { pipelineFailed: "t" } }),
      ),
    ).toBe("cancelled");
  });

  it("is undefined while running, waiting, activating, or unknown (noop)", () => {
    expect(pipelineTerminalOutcome(getPipelineState({ status: "DEPLOYING" }))).toBeUndefined();
    expect(
      pipelineTerminalOutcome(getPipelineState({ status: "WAITING_TO_BUILD" })),
    ).toBeUndefined();
    expect(
      pipelineTerminalOutcome(getPipelineState({ status: "DEPLOYING", activationDate: "t" })),
    ).toBeUndefined();
    expect(pipelineTerminalOutcome(getPipelineState(undefined))).toBeUndefined();
  });
});
