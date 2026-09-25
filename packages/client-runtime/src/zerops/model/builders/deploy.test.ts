import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import { buildDeployFields } from "./deploy.ts";
import type { OperationBuildContext } from "./shared.ts";

const CONTEXT: OperationBuildContext = {
  nowMs: Date.parse("2026-09-01T00:01:00.000Z"),
  projectId: undefined,
};

function deployCall(overrides: Partial<ZeropsCall> & { readonly result?: unknown }): ZeropsCall {
  const { result, ...rest } = overrides;
  return {
    id: "c1",
    turnId: "t1",
    toolName: "zerops_deploy",
    input: { targetService: "apidev" },
    status: result === undefined ? "inProgress" : "completed",
    ...(result === undefined ? {} : { resultText: JSON.stringify(result) }),
    truncated: false,
    startedAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: "a1",
    ...(result === undefined ? {} : { settledAt: "2026-09-01T00:00:50.000Z" }),
    rowIds: new Set(["a1"]),
    agentInternal: false,
    ...rest,
  };
}

describe("buildDeployFields — the version a settled deploy shipped", () => {
  it.each([
    { name: "no version while the call runs", result: undefined, expected: undefined },
    {
      name: "the appVersion id and version name once the result lands",
      result: {
        status: "DEPLOYED",
        targetService: "apidev",
        appVersionId: "av-1",
        versionName: "abc123",
      },
      expected: { id: "av-1", name: "abc123" },
    },
    {
      name: "the version name alone when the build has not resolved an appVersion",
      result: { status: "BUILD_TRIGGERED", targetService: "apidev", versionName: "abc123" },
      expected: { name: "abc123" },
    },
    {
      name: "no version when the result names neither",
      result: { status: "DEPLOYED", targetService: "apidev" },
      expected: undefined,
    },
  ])("$name", ({ result, expected }) => {
    expect(buildDeployFields(deployCall({ result }), CONTEXT).version).toEqual(expected);
  });
});

const SLOT_LABELS = ["Build container", "Build", "Prepare container", "Prepare runtime", "Deploy"];
const slots = (...words: ReadonlyArray<readonly [string, string]>) =>
  words.map(([state, stateLabel], index) => [SLOT_LABELS[index], state, stateLabel]);
const five = (state: string, stateLabel: string) =>
  slots(...Array.from({ length: 5 }, () => [state, stateLabel] as const));

describe("buildDeployFields — the five pipeline slots, from birth to settle", () => {
  it.each([
    { name: "queued while the call runs", overrides: {}, expected: five("queued", "Queued") },
    {
      name: "queued while the triggered build runs",
      overrides: { result: { status: "BUILD_TRIGGERED", targetService: "apidev" } },
      expected: five("queued", "Queued"),
    },
    {
      name: "done once the deploy landed",
      overrides: { result: { status: "DEPLOYED", targetService: "apidev", buildStatus: "ACTIVE" } },
      expected: five("done", "Done"),
    },
    {
      name: "the build failed, the later slots never ran",
      overrides: {
        result: {
          status: "BUILD_FAILED",
          targetService: "apidev",
          buildStatus: "BUILD_FAILED",
          failedPhase: "build",
        },
      },
      expected: slots(
        ["done", "Done"],
        ["failed", "Failed"],
        ["failed", "Cancelled"],
        ["failed", "Cancelled"],
        ["failed", "Cancelled"],
      ),
    },
    {
      name: "the prepare commands failed",
      overrides: {
        result: {
          status: "PREPARING_RUNTIME_FAILED",
          targetService: "apidev",
          failedPhase: "prepare",
        },
      },
      expected: slots(
        ["done", "Done"],
        ["done", "Done"],
        ["done", "Done"],
        ["failed", "Failed"],
        ["failed", "Cancelled"],
      ),
    },
    {
      name: "the new container failed to start",
      overrides: {
        result: { status: "DEPLOY_FAILED", targetService: "apidev", failedPhase: "init" },
      },
      expected: slots(
        ["done", "Done"],
        ["done", "Done"],
        ["done", "Done"],
        ["done", "Done"],
        ["failed", "Failed"],
      ),
    },
    {
      name: "every slot reads the call's own phase when no result reports it",
      overrides: { status: "interrupted" as const, settledAt: "2026-09-01T00:00:50.000Z" },
      expected: five("queued", "Waiting"),
    },
    {
      name: "a failed call that names no failing phase",
      overrides: {
        status: "failed" as const,
        resultText: "service not found",
        settledAt: "2026-09-01T00:00:50.000Z",
      },
      expected: five("failed", "Failed"),
    },
  ])("$name", ({ overrides, expected }) => {
    const fields = buildDeployFields(deployCall(overrides), CONTEXT);
    expect(fields.steps.map((step) => [step.label, step.state, step.stateLabel])).toEqual(expected);
  });
});

const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

describe("buildDeployFields — why a deploy failed or timed out", () => {
  it.each([
    {
      name: "none while the call runs",
      overrides: {},
      expected: undefined,
    },
    {
      name: "none for a deploy that landed",
      overrides: { result: { status: "DEPLOYED", targetService: "apidev", message: "Deployed" } },
      expected: undefined,
    },
    {
      name: "the classified cause and the last 12 build log lines of a failed build",
      overrides: {
        result: {
          status: "BUILD_FAILED",
          targetService: "apidev",
          message: "Build failed",
          failedPhase: "build",
          failureClassification: { category: "build", likelyCause: "Build OOM-killed" },
          buildLogs: lines(20, "build"),
          runtimeLogs: ["unrelated"],
        },
      },
      expected: { reason: "Build OOM-killed", logTail: lines(20, "build").slice(-12) },
    },
    {
      name: "the message and the runtime log of a failed init",
      overrides: {
        result: {
          status: "DEPLOY_FAILED",
          targetService: "apidev",
          message: "initCommand exited 1",
          failedPhase: "init",
          buildLogs: ["build ok"],
          runtimeLogs: ["Error: EADDRINUSE"],
        },
      },
      expected: { reason: "initCommand exited 1", logTail: ["Error: EADDRINUSE"] },
    },
    {
      name: "the message of a build zcp stopped waiting for",
      overrides: {
        result: {
          status: "BUILD_TRIGGERED",
          targetService: "apidev",
          message: "Build still running after 10m",
          timedOut: true,
        },
      },
      expected: { reason: "Build still running after 10m" },
    },
    {
      name: "the classified cause of a call that failed outright",
      overrides: {
        status: "failed" as const,
        result: {
          code: "DEPLOY_FAILED",
          error: "zcli push failed\nlevel=info msg=noise",
          failureClassification: { category: "credential", likelyCause: "GIT_TOKEN missing" },
        },
      },
      expected: { reason: "GIT_TOKEN missing" },
    },
    {
      name: "the result's own evidence when a failed call carries a deploy result",
      overrides: {
        status: "failed" as const,
        result: {
          status: "BUILD_FAILED",
          targetService: "apidev",
          message: "Build failed",
          failedPhase: "build",
          buildLogs: ["npm ERR! missing"],
        },
      },
      expected: { reason: "Build failed", logTail: ["npm ERR! missing"] },
    },
    {
      name: "the first error line of a call that failed with no classification",
      overrides: {
        status: "failed" as const,
        result: { code: "SSH_DEPLOY_FAILED", error: "ssh: connection refused\nmore" },
      },
      expected: { reason: "ssh: connection refused" },
    },
  ])("$name", ({ overrides, expected }) => {
    expect(buildDeployFields(deployCall(overrides), CONTEXT).explanation).toEqual(expected);
  });
});

describe("buildDeployFields — zerops_deploy_batch, one entry per service", () => {
  const input = {
    targets: [
      { sourceService: "apidev", targetService: "apistage" },
      { sourceService: "webdev", targetService: "webstage" },
    ],
  };
  const batchCall = (result?: unknown) =>
    deployCall({ toolName: "zerops_deploy_batch", input, result });
  const entry = (target: string, result: Record<string, unknown> | undefined, error?: string) => ({
    target: { targetService: target },
    ...(result === undefined ? {} : { result: { targetService: target, ...result } }),
    ...(error === undefined ? {} : { error }),
    startedAt: "2026-09-01T00:00:00Z",
    endedAt: "2026-09-01T00:00:40Z",
  });

  it.each([
    {
      name: "names every target from the input while the batch runs",
      result: undefined,
      expected: {
        subject: "apistage, webstage",
        phase: "running",
        steps: [
          ["apistage", "running"],
          ["webstage", "running"],
        ],
      },
    },
    {
      name: "settles each target in place from its own result",
      result: {
        entries: [
          entry("apistage", { status: "DEPLOYED" }),
          entry("webstage", { status: "DEPLOYED" }),
        ],
        summary: "2/2 succeeded",
      },
      expected: {
        subject: "apistage, webstage",
        phase: "done",
        steps: [
          ["apistage", "done"],
          ["webstage", "done"],
        ],
      },
    },
    {
      name: "fails the card when one target failed, and keeps the other done",
      result: {
        entries: [
          entry("apistage", { status: "DEPLOYED" }),
          entry("webstage", undefined, "ssh: connection refused"),
        ],
        summary: "1/2 succeeded, 1 failed",
      },
      expected: {
        subject: "apistage, webstage",
        phase: "failed",
        steps: [
          ["apistage", "done"],
          ["webstage", "failed"],
        ],
      },
    },
  ])("$name", ({ result, expected }) => {
    const fields = buildDeployFields(batchCall(result), CONTEXT);
    expect({
      subject: fields.subject,
      phase: fields.phaseOverride,
      steps: fields.steps.map((step) => [step.label, step.state]),
    }).toEqual(expected);
  });

  it.each([
    { name: "a batch is marked a batch", call: batchCall(), expected: true },
    { name: "a single-service deploy is not", call: deployCall({}), expected: undefined },
  ])("$name", ({ call, expected }) => {
    expect(buildDeployFields(call, CONTEXT).batch).toBe(expected);
  });

  it("explains the first failed target with its own reason and log", () => {
    const fields = buildDeployFields(
      batchCall({
        entries: [
          entry("apistage", {
            status: "BUILD_FAILED",
            message: "Build failed",
            failedPhase: "build",
            buildLogs: ["npm ERR! missing"],
          }),
          entry("webstage", { status: "DEPLOYED" }),
        ],
      }),
      CONTEXT,
    );
    expect(fields.explanation).toEqual({ reason: "Build failed", logTail: ["npm ERR! missing"] });
    expect(fields.steps[0]?.note).toBe("Build failed");
  });
});
