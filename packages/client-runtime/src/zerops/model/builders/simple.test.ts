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
});

describe("buildSimpleFields — what an env call changed and where, by its input", () => {
  const envCall = (input: Record<string, unknown>, status: ZeropsCall["status"] = "completed") => ({
    ...simpleCall(
      "zerops_env",
      status,
      status === "inProgress" ? undefined : { process: proc("FINISHED") },
    ),
    input,
  });
  it.each([
    {
      name: "the project's variables, counted",
      input: { action: "set", project: true, variables: ["A=1", "B=2", "C=3"] },
      subject: "the project",
      envChange: { action: "set", scope: "project", count: 3 },
      target: undefined,
    },
    {
      name: "a stringified project flag still names the project",
      input: { action: "delete", project: "true", variables: ["A"] },
      subject: "the project",
      envChange: { action: "delete", scope: "project", count: 1 },
      target: undefined,
    },
    {
      name: "a service's variables, by its name",
      input: { action: "set", serviceHostname: "apidev", variables: ["A=1", "B=2"] },
      subject: "apidev",
      envChange: { action: "set", scope: "service", service: "apidev", count: 2 },
      target: { hostname: "apidev" },
    },
    {
      name: "the count the live step relays in place of the variables",
      input: { action: "set", project: "true", variablesCount: "6" },
      subject: "the project",
      envChange: { action: "set", scope: "project", count: 6 },
      target: undefined,
    },
    {
      name: "a read names no count",
      input: { action: "get", project: true },
      subject: "the project",
      envChange: { action: "get", scope: "project" },
      target: undefined,
    },
    {
      name: "a .env written from a setup block",
      input: { action: "generate-dotenv", setup: "dev" },
      subject: "dev",
      envChange: { action: "dotenv", scope: "service", service: "dev" },
      target: undefined,
    },
    {
      name: "an action it does not know",
      input: { serviceHostname: "apidev" },
      subject: "apidev",
      envChange: { action: "update", scope: "service", service: "apidev" },
      target: { hostname: "apidev" },
    },
  ])("$name", ({ input, subject, envChange, target }) => {
    const fields = buildSimpleFields("env", envCall(input));
    expect(fields.subject).toBe(subject);
    expect(fields.envChange).toEqual(envChange);
    expect(fields.target).toEqual(target);
  });

  it("never carries a value it was given", () => {
    const secret = ["s3", "cr", "et-value"].join("");
    const fields = buildSimpleFields(
      "env",
      envCall({ action: "set", project: true, variables: [`TOKEN=${secret}`] }, "inProgress"),
    );
    expect(JSON.stringify(fields)).not.toContain(secret);
    expect(fields.voice).toBe("Setting one of the project's variables.");
  });
});
