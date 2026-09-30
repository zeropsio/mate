import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import { buildStandupFields } from "./standup.ts";

const CONTEXT = { nowMs: Date.parse("2026-09-01T00:30:00.000Z"), projectId: "proj" };

function standupCall(
  id: string,
  status: ZeropsCall["status"],
  result: unknown | undefined,
): ZeropsCall {
  return {
    id,
    turnId: "t1",
    toolName: "zerops_standup",
    input: {},
    status,
    ...(result === undefined
      ? {}
      : { resultText: typeof result === "string" ? result : JSON.stringify(result) }),
    truncated: false,
    startedAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: `a-${id}`,
    ...(status === "inProgress" ? {} : { settledAt: "2026-09-01T00:20:00.000Z" }),
    rowIds: new Set([`a-${id}`]),
    agentInternal: false,
  };
}

const deployed = (hostname: string, url?: string) => ({
  hostname,
  role: hostname.endsWith("stage") ? "stage" : "dev",
  deploy: { status: "deployed", ...(url === undefined ? {} : { url }) },
  next: "",
});

const queued = (hostname: string, dev: string) => ({
  hostname,
  role: "stage",
  deploy: {
    status: "queued",
    reason: `${dev} was deployed on this call, and the stage builds on the next zerops_standup call`,
  },
  next: "",
});

/** zcp's first call: every dev half stands, each stage queued for the next call. */
const DEVELOPMENT_UP = {
  standUp: "development",
  message: "0 of 2 pairs stand and 2 of 2 dev halves run.",
  services: [
    deployed("apidev", "https://apidev.example.test"),
    queued("apistage", "apidev"),
    deployed("webdev", "https://webdev.example.test"),
    queued("webstage", "webdev"),
    { hostname: "db", role: "managed", next: "" },
  ],
  next: "",
};

/** A first call where one dev half failed: its stage is not deployed, the other's queued. */
const DEV_FAILED = {
  standUp: "partial",
  message: "0 of 2 pairs stand and 1 of 2 dev halves run.",
  services: [
    deployed("apidev"),
    queued("apistage", "apidev"),
    {
      hostname: "webdev",
      role: "dev",
      deploy: { status: "failed", reason: "npm install exited with 1" },
      next: "",
    },
    {
      hostname: "webstage",
      role: "stage",
      deploy: {
        status: "not deployed",
        reason: "webdev did not deploy, and the stage is built from it",
      },
      next: "",
    },
  ],
  next: "",
};

const already = (hostname: string) => ({
  hostname,
  role: "dev",
  deploy: { status: "already deployed" },
  next: "",
});

/** zcp's second call: the dev halves already run, every stage deployed. */
const STAGE_READY = {
  standUp: "ready",
  message: "2 of 2 pairs stand and 2 of 2 dev halves run.",
  services: [
    already("apidev"),
    deployed("apistage", "https://apistage.example.test"),
    already("webdev"),
    deployed("webstage", "https://webstage.example.test"),
  ],
  next: "",
};

const STAGE_PARTIAL = {
  standUp: "partial",
  message: "1 of 2 pairs stand and 2 of 2 dev halves run.",
  services: [
    already("apidev"),
    deployed("apistage", "https://apistage.example.test"),
    already("webdev"),
    {
      hostname: "webstage",
      role: "stage",
      deploy: { status: "failed", reason: "the build ran out of memory" },
      next: "",
    },
  ],
  next: "",
};

/** A report from before zcp said "development": the stages carry no deploy. */
const DEVELOPMENT_UP_UNMARKED = {
  standUp: "partial",
  message: "0 of 2 pairs stand.",
  services: [
    deployed("apidev"),
    { hostname: "apistage", role: "stage", next: "" },
    deployed("webdev"),
    { hostname: "webstage", role: "stage", next: "" },
  ],
  next: "",
};

/** A pair that failed before its deploy: its dev half carries zcp's pair-level failure. */
const CHECKOUT_FAILED = {
  standUp: "partial",
  message: "0 of 2 pairs stand and 1 of 2 dev halves run.",
  services: [
    {
      hostname: "apidev",
      role: "dev",
      pair: "apistage",
      failed: "checking main out into apidev failed: the repository is empty",
      next: "",
    },
    {
      hostname: "apistage",
      role: "stage",
      pair: "apidev",
      deploy: {
        status: "not deployed",
        reason: "apidev did not stand up, and the stage is built from it",
      },
      next: "",
    },
    deployed("webdev"),
    queued("webstage", "webdev"),
  ],
  next: "",
};

/** A development call whose poll gave up on one build: partial, but nothing failed. */
const DEV_STILL_BUILDING = {
  standUp: "partial",
  message: "0 of 2 pairs stand and 1 of 2 dev halves run.",
  services: [
    deployed("apidev"),
    queued("apistage", "apidev"),
    { hostname: "webdev", role: "dev", deploy: { status: "still building" }, next: "" },
    {
      hostname: "webstage",
      role: "stage",
      deploy: {
        status: "not deployed",
        reason: "webdev did not deploy, and the stage is built from it",
      },
      next: "",
    },
  ],
  next: "",
};

/** A retry: apidev ran code already, so the development call built its stage too. */
const RETRY_WITH_A_STAGE = {
  standUp: "partial",
  message: "0 of 2 pairs stand and 2 of 2 dev halves run.",
  services: [
    already("apidev"),
    {
      hostname: "apistage",
      role: "stage",
      deploy: { status: "failed", reason: "the build ran out of memory" },
      next: "",
    },
    deployed("webdev"),
    queued("webstage", "webdev"),
  ],
  next: "",
};

/** A stage call where a stage failed, and the one reading it waits. */
const STAGE_HELD = {
  standUp: "partial",
  message: "0 of 2 pairs stand and 2 of 2 dev halves run.",
  services: [
    already("apidev"),
    {
      hostname: "apistage",
      role: "stage",
      deploy: { status: "failed", reason: "the build ran out of memory" },
      next: "",
    },
    already("webdev"),
    {
      hostname: "webstage",
      role: "stage",
      deploy: {
        status: "not deployed",
        reason:
          "waits for apistage, which did not stand up: a stage is built after every stage above it by priority, whose API its build may read",
      },
      next: "",
    },
  ],
  next: "",
};

const NEXT = (hostname: string) => ({
  id: hostname,
  label: hostname,
  state: "queued",
  stateLabel: "Next",
});

describe("buildStandupFields — a stand-up call, named by the half it deploys", () => {
  it.each([
    {
      name: "the first call, running: development, its services unknown yet",
      call: standupCall("c2", "inProgress", undefined),
      earlier: [],
      expected: {
        subject: "development",
        voice: "Standing development up.",
        phase: "running",
        steps: [],
      },
    },
    {
      name: "after the development call, running: stage, its services the queued stages",
      call: standupCall("c2", "inProgress", undefined),
      earlier: [standupCall("c1", "completed", DEVELOPMENT_UP)],
      expected: {
        subject: "stage",
        voice: "Standing stage up.",
        phase: "running",
        steps: [NEXT("apistage"), NEXT("webstage")],
      },
    },
    {
      name: "after a report that does not say development, running: stage by the fallback",
      call: standupCall("c2", "inProgress", undefined),
      earlier: [standupCall("c1", "completed", DEVELOPMENT_UP_UNMARKED)],
      expected: { subject: "stage", phase: "running", steps: [] },
    },
    {
      name: "a retry after a dev half failed, running: development again",
      call: standupCall("c2", "inProgress", undefined),
      earlier: [standupCall("c1", "completed", DEV_FAILED)],
      expected: { subject: "development", phase: "running", steps: [] },
    },
    {
      name: "the development call settled: each dev half it deployed, the stages next",
      call: standupCall("c1", "completed", DEVELOPMENT_UP),
      earlier: [],
      expected: {
        subject: "development",
        phase: "done",
        statusWord: "Stood up",
        steps: [
          { id: "apidev", label: "apidev", state: "done", stateLabel: "Deployed" },
          NEXT("apistage"),
          { id: "webdev", label: "webdev", state: "done", stateLabel: "Deployed" },
          NEXT("webstage"),
        ],
        links: [
          { label: "apidev", url: "https://apidev.example.test" },
          { label: "webdev", url: "https://webdev.example.test" },
        ],
      },
    },
    {
      name: "the development call with a dev half failed: its stage is not the call's",
      call: standupCall("c1", "completed", DEV_FAILED),
      earlier: [],
      expected: {
        subject: "development",
        phase: "failed",
        steps: [
          { id: "apidev", label: "apidev", state: "done", stateLabel: "Deployed" },
          NEXT("apistage"),
          {
            id: "webdev",
            label: "webdev",
            state: "failed",
            stateLabel: "Failed",
            note: "npm install exited with 1",
          },
        ],
        explanation: { reason: "npm install exited with 1" },
      },
    },
    {
      name: "the stage call settled: each stage, the dev halves it found running left out",
      call: standupCall("c2", "completed", STAGE_READY),
      earlier: [standupCall("c1", "completed", DEVELOPMENT_UP)],
      expected: {
        subject: "stage",
        phase: "done",
        steps: [
          { id: "apistage", label: "apistage", state: "done", stateLabel: "Deployed" },
          { id: "webstage", label: "webstage", state: "done", stateLabel: "Deployed" },
        ],
        links: [
          { label: "apistage", url: "https://apistage.example.test" },
          { label: "webstage", url: "https://webstage.example.test" },
        ],
      },
    },
    {
      name: "the stage call settled with one failed: failed, the failure its reason",
      call: standupCall("c2", "completed", STAGE_PARTIAL),
      earlier: [standupCall("c1", "completed", DEVELOPMENT_UP)],
      expected: {
        subject: "stage",
        phase: "failed",
        steps: [
          { id: "apistage", label: "apistage", state: "done", stateLabel: "Deployed" },
          {
            id: "webstage",
            label: "webstage",
            state: "failed",
            stateLabel: "Failed",
            note: "the build ran out of memory",
          },
        ],
        links: [{ label: "apistage", url: "https://apistage.example.test" }],
        explanation: { reason: "the build ran out of memory" },
      },
    },
    {
      name: "a pair that failed before its deploy: its dev half fails with zcp's words",
      call: standupCall("c1", "completed", CHECKOUT_FAILED),
      earlier: [],
      expected: {
        subject: "development",
        phase: "failed",
        steps: [
          {
            id: "apidev",
            label: "apidev",
            state: "failed",
            stateLabel: "Failed",
            note: "checking main out into apidev failed: the repository is empty",
          },
          { id: "webdev", label: "webdev", state: "done", stateLabel: "Deployed" },
          NEXT("webstage"),
        ],
        explanation: { reason: "checking main out into apidev failed: the repository is empty" },
      },
    },
    {
      name: "a build the call stopped waiting for: still running, and no failure",
      call: standupCall("c1", "completed", DEV_STILL_BUILDING),
      earlier: [],
      expected: {
        subject: "development",
        phase: "done",
        steps: [
          { id: "apidev", label: "apidev", state: "done", stateLabel: "Deployed" },
          NEXT("apistage"),
          { id: "webdev", label: "webdev", state: "running", stateLabel: "Building" },
        ],
      },
    },
    {
      name: "a retry that built a stage in the development call: the stage is the call's",
      call: standupCall("c3", "completed", RETRY_WITH_A_STAGE),
      earlier: [standupCall("c1", "completed", DEV_FAILED)],
      expected: {
        subject: "development",
        phase: "failed",
        steps: [
          {
            id: "apistage",
            label: "apistage",
            state: "failed",
            stateLabel: "Failed",
            note: "the build ran out of memory",
          },
          { id: "webdev", label: "webdev", state: "done", stateLabel: "Deployed" },
          NEXT("webstage"),
        ],
      },
    },
    {
      name: "a stage held by a stage above it that failed: it waits, it did not fail",
      call: standupCall("c2", "completed", STAGE_HELD),
      earlier: [standupCall("c1", "completed", DEVELOPMENT_UP)],
      expected: {
        subject: "stage",
        phase: "failed",
        steps: [
          {
            id: "apistage",
            label: "apistage",
            state: "failed",
            stateLabel: "Failed",
            note: "the build ran out of memory",
          },
          {
            id: "webstage",
            label: "webstage",
            state: "queued",
            stateLabel: "Waits",
            note: "apistage did not stand up",
          },
        ],
        explanation: { reason: "the build ran out of memory" },
      },
    },
    {
      name: "a refusal before anything was touched: failed, with zcp's words",
      call: standupCall("c1", "failed", {
        error: "NO_GIT_ACCESS",
        message: "This Mate has no Git access yet.",
      }),
      earlier: [],
      expected: { subject: "development", phase: "failed", steps: [] },
    },
  ])("$name", ({ call, earlier, expected }) => {
    const fields = buildStandupFields(call, CONTEXT, earlier);
    expect({ ...fields, phase: fields.phaseOverride }).toMatchObject(expected);
  });
});
