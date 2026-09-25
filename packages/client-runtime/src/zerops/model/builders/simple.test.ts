import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import { buildSimpleFields } from "./simple.ts";

function simpleCall(
  toolName: string,
  status: ZeropsCall["status"],
  result: unknown | undefined,
): ZeropsCall {
  return {
    id: "c1",
    turnId: "t1",
    toolName,
    input: { serviceHostname: "apidev" },
    status,
    ...(result === undefined ? {} : { resultText: JSON.stringify(result) }),
    truncated: false,
    startedAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: "a1",
    ...(status === "inProgress" ? {} : { settledAt: "2026-09-01T00:00:30.000Z" }),
    rowIds: new Set(["a1"]),
    agentInternal: false,
  };
}

const proc = (status: string, failReason?: string) => ({
  id: "proc-1",
  actionName: "stack.scale",
  status,
  created: "2026-09-01T00:00:01Z",
  ...(failReason === undefined ? {} : { failReason }),
});

describe("buildSimpleFields — why a delete / scale / manage / env failed or timed out", () => {
  it.each([
    {
      name: "none while it runs",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "inProgress", undefined),
      expected: undefined,
    },
    {
      name: "none when the process finished",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "completed", { process: proc("FINISHED") }),
      expected: undefined,
    },
    {
      name: "the platform's reason for a process that failed",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "completed", {
        process: proc("FAILED", "quota exceeded"),
        message: "Scaling apidev",
      }),
      expected: { reason: "quota exceeded" },
    },
    {
      name: "the message of a process zcp stopped waiting for",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "completed", {
        process: proc("RUNNING"),
        timedOut: true,
        message: "Scale still running after 5m",
      }),
      expected: { reason: "Scale still running after 5m" },
    },
    {
      name: "delete's own warning when it timed out",
      kind: "delete" as const,
      call: simpleCall("zerops_delete", "completed", {
        process: proc("RUNNING"),
        timedOut: true,
        warning: "Delete not confirmed yet",
      }),
      expected: { reason: "Delete not confirmed yet" },
    },
    {
      name: "the error of a call that failed outright",
      kind: "manage" as const,
      call: simpleCall("zerops_manage", "failed", {
        code: "SERVICE_NOT_FOUND",
        error: "Service apidev not found\ndetails",
      }),
      expected: { reason: "Service apidev not found" },
    },
  ])("$name", ({ kind, call, expected }) => {
    expect(buildSimpleFields(kind, call).explanation).toEqual(expected);
  });

  it("carries zcp's next actions into the detail", () => {
    const fields = buildSimpleFields(
      "manage",
      simpleCall("zerops_manage", "completed", {
        ...proc("FINISHED"),
        nextActions: "Verify apidev next.",
      }),
    );
    expect(fields.detail).toContain("Verify apidev next.");
  });
});
