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
        ["queued", "Cancelled"],
        ["queued", "Cancelled"],
        ["queued", "Cancelled"],
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
        ["queued", "Cancelled"],
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

/**
 * zcp returns BUILD_FAILED and kin as a successful call. Read as its call's
 * status, the card said "Deployed" and "apidev is live." under a failed
 * build, with the URL chip of a service that never got the version.
 */
describe("buildDeployFields — a result that reports its own failure settles failed", () => {
  it.each([
    {
      name: "a failed build: its message, the cause left to the explanation",
      result: {
        status: "BUILD_FAILED",
        targetService: "apidev",
        message: "Build failed",
        failedPhase: "build",
        failureClassification: { category: "build", likelyCause: "Build OOM-killed" },
        subdomainUrl: "https://apidev-26a7-3000.prg1.zerops.app",
      },
      closing: "Build failed",
    },
    {
      name: "a failed prepare: its message",
      result: {
        status: "PREPARING_RUNTIME_FAILED",
        targetService: "apidev",
        message: "Prepare commands failed\nmore",
        failedPhase: "prepare",
      },
      closing: "Prepare commands failed",
    },
    {
      name: "a container that did not start",
      result: {
        status: "DEPLOY_FAILED",
        targetService: "apidev",
        message: "initCommand exited 1",
        failedPhase: "init",
      },
      closing: "initCommand exited 1",
    },
  ])("$name", ({ result, closing }) => {
    const fields = buildDeployFields(deployCall({ result }), CONTEXT);

    expect(fields.phaseOverride).toBe("failed");
    expect(fields.statusWord).toBe("Failed");
    expect(fields.closing).toBe(closing);
    expect(fields.links).toEqual([]);
  });

  it("a deploy that landed stays done", () => {
    const fields = buildDeployFields(
      deployCall({ result: { status: "DEPLOYED", targetService: "apidev" } }),
      CONTEXT,
    );
    expect([fields.phaseOverride, fields.statusWord]).toEqual(["done", "Deployed"]);
  });
});

/**
 * `zerops_deploy` with `strategy: "git-push"` answers zcp's
 * `deployGitPushResponse` (`internal/tools/deploy_git_push.go`): an
 * `ops.GitPushResult` (`internal/ops/deploy_common.go`) and, for a push to this
 * Mate's HQ, the change the push lands through. It is a deploy
 * only once the build its push triggered was watched to ACTIVE (`DELIVERED`).
 * Read as a deploy, a two-second push to a branch said "Done", "Deploying
 * appdev." and five build steps it never ran.
 */
const GIT_PUSH_INPUT = { targetService: "appdev", strategy: "git-push" };
const REMOTE = "https://git.example.com/acme/app.git";
const gitPush = (result?: unknown, overrides: Partial<ZeropsCall> = {}) =>
  deployCall({ input: GIT_PUSH_INPUT, result, ...overrides });
const pushResult = (fields: Record<string, unknown> = {}) => ({
  status: "PUSHED",
  remoteUrl: REMOTE,
  branch: "main",
  message: `Code pushed from appdev to ${REMOTE} (branch: main)`,
  ...fields,
});
const GIT_PUSH_CASES = {
  running: gitPush(),
  pushedForPullRequest: gitPush(
    pushResult({
      branch: "mate/fen",
      pullRequest: {
        repo: "acme/app",
        branch: "mate/fen",
        base: "main",
        number: 8,
        created: true,
        url: "https://git.example.com/acme/app/pulls/8",
      },
    }),
  ),
  pushed: gitPush(pushResult()),
  pushedWithNoBuildWired: gitPush(pushResult({ buildTarget: "appstage" })),
  upToDate: gitPush({
    status: "NOTHING_TO_PUSH",
    remoteUrl: REMOTE,
    branch: "main",
    message: "Nothing to push from appdev — remote is up to date",
  }),
  delivered: gitPush(
    pushResult({
      status: "DELIVERED",
      buildTarget: "appstage",
      buildStatus: "ACTIVE",
      buildObserved: true,
      autoRecorded: true,
      verifyTarget: "appstage",
    }),
  ),
  buildFailed: gitPush(
    pushResult({
      buildTarget: "appstage",
      buildStatus: "FAILED",
      buildObserved: true,
      failureClassification: {
        category: "build",
        likelyCause: "Build pipeline failed; no recognized log pattern matched.",
      },
      buildLogs: lines(20, "build"),
    }),
  ),
  // zcp's build watch only ends on ACTIVE/FAILED/CANCELED, so a build the
  // platform failed as BUILD_FAILED comes back as a watch that gave up.
  buildFailedPastTheWatch: gitPush(
    pushResult({ buildTarget: "appstage", buildStatus: "BUILD_FAILED", buildObserved: true }),
  ),
  prepareFailedPastTheWatch: gitPush(
    pushResult({
      buildTarget: "appstage",
      buildStatus: "PREPARING_RUNTIME_FAILED",
      buildObserved: true,
    }),
  ),
  noBuildFollowed: gitPush(pushResult({ buildTarget: "appstage", buildStatus: "NOT_OBSERVED" })),
  buildStillRunning: gitPush(
    pushResult({ buildTarget: "appstage", buildStatus: "BUILDING", buildObserved: true }),
  ),
  refused: gitPush({
    status: "GIT_TOKEN_MISSING",
    message:
      "meta records git-push as configured for appdev, but the service env carries no GIT_TOKEN secret.",
    instructions: 'Re-run zerops_workflow action="git-push-setup" service="appdev".',
  }),
  pushFailed: gitPush(
    {
      code: "SSH_DEPLOY_FAILED",
      error: "git-push from appdev failed: ! [rejected] main -> main (fetch first)\nhint: more",
      failureClassification: { category: "credential", likelyCause: "GIT_TOKEN rejected" },
    },
    { status: "failed" },
  ),
  interrupted: gitPush(undefined, {
    status: "interrupted",
    settledAt: "2026-09-01T00:00:50.000Z",
  }),
  unknownResult: gitPush({ status: "SOMETHING_NEW", branch: "main" }),
} satisfies Record<string, ZeropsCall>;

describe("buildDeployFields — a git push says what it did, a deploy only once its build landed", () => {
  it.each([
    { name: "pushing while the call runs", call: "running", expected: ["running", "Pushing"] },
    { name: "pushed", call: "pushed", expected: ["done", "Pushed"] },
    { name: "nothing new to push", call: "upToDate", expected: ["done", "Up to date"] },
    { name: "the build it triggered landed", call: "delivered", expected: ["done", "Deployed"] },
    { name: "the build it triggered failed", call: "buildFailed", expected: ["failed", "Failed"] },
    {
      name: "the build failed after zcp stopped watching for its end",
      call: "buildFailedPastTheWatch",
      expected: ["failed", "Failed"],
    },
    {
      name: "no build followed the push",
      call: "noBuildFollowed",
      expected: ["uncertain", "Unconfirmed"],
    },
    {
      name: "the build was still running when zcp stopped watching",
      call: "buildStillRunning",
      expected: ["uncertain", "Unconfirmed"],
    },
    { name: "refused before pushing", call: "refused", expected: ["failed", "Failed"] },
    { name: "the push itself failed", call: "pushFailed", expected: ["failed", "Failed"] },
    { name: "interrupted", call: "interrupted", expected: ["interrupted", "Interrupted"] },
    {
      name: "a result this build cannot read claims nothing",
      call: "unknownResult",
      expected: ["done", "Done"],
    },
  ] as const)("$name", ({ call, expected }) => {
    const fields = buildDeployFields(GIT_PUSH_CASES[call], CONTEXT);
    expect([fields.phaseOverride, fields.statusWord]).toEqual(expected);
    // Marked a push on the operation itself: a batch's service named "push"
    // is never read as one (its one step is named by the service).
    expect(fields.strategy).toBe("git-push");
  });

  it.each([
    { call: "running", expected: undefined },
    { call: "pushedForPullRequest", expected: "Pushed to change #8." },
    { call: "pushed", expected: "Pushed to main." },
    { call: "pushedWithNoBuildWired", expected: "Pushed to main." },
    { call: "upToDate", expected: "Nothing new to push." },
    { call: "delivered", expected: "appstage is live." },
    {
      call: "buildFailed",
      expected: "Build pipeline failed; no recognized log pattern matched.",
    },
    { call: "buildFailedPastTheWatch", expected: "Failed." },
    { call: "noBuildFollowed", expected: "No result from the build. Check it in Zerops." },
    { call: "buildStillRunning", expected: "No result from the build. Check it in Zerops." },
    {
      call: "refused",
      expected:
        "meta records git-push as configured for appdev, but the service env carries no GIT_TOKEN secret.",
    },
    {
      call: "pushFailed",
      expected: "git-push from appdev failed: ! [rejected] main -> main (fetch first)",
    },
    { call: "unknownResult", expected: "Finished." },
  ] as const)("its closing, $call: $expected", ({ call, expected }) => {
    expect(buildDeployFields(GIT_PUSH_CASES[call], CONTEXT).closing).toBe(expected);
  });

  // The change a run's push lands through, by its repository in the group's
  // org and its number: what the run's result follows on the forge.
  it.each([
    { call: "pushedForPullRequest", expected: { repository: "app", number: 8 } },
    { call: "pushed", expected: undefined },
    { call: "running", expected: undefined },
    { call: "refused", expected: undefined },
  ] as const)("names the pull request it pushed to, $call", ({ call, expected }) => {
    expect(buildDeployFields(GIT_PUSH_CASES[call], CONTEXT).pullRequest).toEqual(expected);
  });

  it.each([
    { name: "while it runs", call: gitPush() },
    { name: "once it pushed", call: GIT_PUSH_CASES.pushed },
    { name: "once its build landed", call: GIT_PUSH_CASES.delivered },
    {
      name: "when only the result says it was a push",
      call: deployCall({ input: { targetService: "appdev" }, result: pushResult() }),
    },
  ])("names a push, never a deploy, $name", ({ call }) => {
    const fields = buildDeployFields(call, CONTEXT);
    expect([fields.subject, fields.kicker, fields.voice]).toEqual([
      "appdev",
      "Push · appdev",
      "Pushing appdev.",
    ]);
  });
});

const PUSH_STEP = (state: string, stateLabel: string) => [["Push", state, stateLabel]];

describe("buildDeployFields — a git push holds one push step, the pipeline only for a build it watched", () => {
  it.each([
    { call: "running", expected: PUSH_STEP("running", "Running") },
    { call: "pushedForPullRequest", expected: PUSH_STEP("done", "Done") },
    { call: "upToDate", expected: PUSH_STEP("done", "Done") },
    { call: "noBuildFollowed", expected: PUSH_STEP("done", "Done") },
    { call: "buildStillRunning", expected: PUSH_STEP("done", "Done") },
    { call: "refused", expected: PUSH_STEP("failed", "Failed") },
    { call: "pushFailed", expected: PUSH_STEP("failed", "Failed") },
    { call: "interrupted", expected: PUSH_STEP("queued", "Waiting") },
    { call: "unknownResult", expected: PUSH_STEP("done", "Done") },
    { call: "delivered", expected: five("done", "Done") },
    {
      call: "buildFailedPastTheWatch",
      expected: slots(
        ["done", "Done"],
        ["failed", "Failed"],
        ["queued", "Cancelled"],
        ["queued", "Cancelled"],
        ["queued", "Cancelled"],
      ),
    },
    {
      call: "prepareFailedPastTheWatch",
      expected: slots(
        ["done", "Done"],
        ["done", "Done"],
        ["done", "Done"],
        ["failed", "Failed"],
        ["queued", "Cancelled"],
      ),
    },
  ] as const)("$call", ({ call, expected }) => {
    const fields = buildDeployFields(GIT_PUSH_CASES[call], CONTEXT);
    expect(fields.steps.map((step) => [step.label, step.state, step.stateLabel])).toEqual(expected);
  });
});

/**
 * zcp builds a standard pair's push on its stage half (`buildTarget`), so a
 * build the push was watched to is that service's deploy — and a push that
 * built nothing leaves the push source's result as zcp stated it.
 */
describe("buildDeployFields — the service a git push's outcome is about", () => {
  it.each([
    { call: "running", expected: ["appdev", undefined] },
    { call: "pushed", expected: ["appdev", "PUSHED"] },
    { call: "pushedWithNoBuildWired", expected: ["appdev", "PUSHED"] },
    { call: "upToDate", expected: ["appdev", "NOTHING_TO_PUSH"] },
    { call: "delivered", expected: ["appstage", "DELIVERED"] },
    { call: "buildFailed", expected: ["appstage", "PUSHED"] },
    { call: "noBuildFollowed", expected: ["appstage", "PUSHED"] },
    { call: "refused", expected: ["appdev", "GIT_TOKEN_MISSING"] },
    { call: "pushFailed", expected: ["appdev", undefined] },
  ] as const)("$call", ({ call, expected }) => {
    const fields = buildDeployFields(GIT_PUSH_CASES[call], CONTEXT);
    expect([fields.target?.hostname, fields.resultStatus]).toEqual(expected);
  });
});

describe("buildDeployFields — why a git push failed", () => {
  it.each([
    { call: "pushed", expected: undefined },
    {
      call: "buildFailed",
      expected: {
        reason: "Build pipeline failed; no recognized log pattern matched.",
        logTail: lines(20, "build").slice(-12),
      },
    },
    { call: "buildFailedPastTheWatch", expected: undefined },
    {
      call: "refused",
      expected: {
        reason:
          "meta records git-push as configured for appdev, but the service env carries no GIT_TOKEN secret.",
      },
    },
    { call: "pushFailed", expected: { reason: "GIT_TOKEN rejected" } },
  ] as const)("$call", ({ call, expected }) => {
    expect(buildDeployFields(GIT_PUSH_CASES[call], CONTEXT).explanation).toEqual(expected);
  });
});
