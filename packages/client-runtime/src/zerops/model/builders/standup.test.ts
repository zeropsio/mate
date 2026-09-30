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

/** The development call's report: both dev halves up, the stages the next call's. */
const DEVELOPMENT_UP = {
  standUp: "ready",
  message: "Development is up.",
  services: [
    deployed("apidev", "https://apidev.example.test"),
    { hostname: "apistage", role: "stage", next: "" },
    deployed("webdev", "https://webdev.example.test"),
    { hostname: "webstage", role: "stage", next: "" },
    { hostname: "db", role: "managed", next: "" },
  ],
  next: "",
};

const DEV_FAILED = {
  standUp: "partial",
  message: "One dev half did not deploy.",
  services: [
    deployed("apidev"),
    {
      hostname: "webdev",
      role: "dev",
      deploy: { status: "failed", reason: "npm install exited with 1" },
      next: "",
    },
    { hostname: "apistage", role: "stage", next: "" },
    { hostname: "webstage", role: "stage", next: "" },
  ],
  next: "",
};

const STAGE_PARTIAL = {
  standUp: "partial",
  message: "One stage did not deploy.",
  services: [
    { ...deployed("apidev"), deploy: { status: "already deployed" } },
    { ...deployed("webdev"), deploy: { status: "already deployed" } },
    deployed("apistage", "https://apistage.example.test"),
    {
      hostname: "webstage",
      role: "stage",
      deploy: { status: "failed", reason: "the build ran out of memory" },
      next: "",
    },
  ],
  next: "",
};

describe("buildStandupFields — a stand-up call, named by the half it deploys", () => {
  it.each([
    {
      name: "the first call, running: development",
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
      name: "a call after one that stood development up, running: stage",
      call: standupCall("c2", "inProgress", undefined),
      earlier: [standupCall("c1", "completed", DEVELOPMENT_UP)],
      expected: { subject: "stage", voice: "Standing stage up.", phase: "running", steps: [] },
    },
    {
      name: "a retry after a dev half failed, running: development again",
      call: standupCall("c2", "inProgress", undefined),
      earlier: [standupCall("c1", "completed", DEV_FAILED)],
      expected: { subject: "development", phase: "running", steps: [] },
    },
    {
      name: "the development call settled: each dev half it deployed",
      call: standupCall("c1", "completed", DEVELOPMENT_UP),
      earlier: [],
      expected: {
        subject: "development",
        phase: "done",
        statusWord: "Stood up",
        steps: [
          { id: "apidev", label: "apidev", state: "done", stateLabel: "Deployed" },
          { id: "webdev", label: "webdev", state: "done", stateLabel: "Deployed" },
        ],
        links: [
          { label: "apidev", url: "https://apidev.example.test" },
          { label: "webdev", url: "https://webdev.example.test" },
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
