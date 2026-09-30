import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import { buildDevServerFields } from "./devServer.ts";
import { buildVerifyFields } from "./verify.ts";

function call(toolName: string, input: Record<string, unknown>, result: unknown): ZeropsCall {
  return {
    id: "c1",
    turnId: "t1",
    toolName,
    input,
    status: "completed",
    resultText: JSON.stringify(result),
    truncated: false,
    startedAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: "a1",
    settledAt: "2026-09-01T00:00:30.000Z",
    rowIds: new Set(["a1"]),
    agentInternal: false,
  };
}

describe("buildVerifyFields — why a check failed is the person's to read", () => {
  it.each([
    {
      name: "a failed check says why beside its code",
      check: { name: "http_internal", status: "fail", httpStatus: 502, detail: "bad gateway" },
      note: "502 · bad gateway",
    },
    {
      name: "a failed check with no code says why alone",
      check: { name: "service_running", status: "fail", detail: "container is stopped" },
      note: "container is stopped",
    },
    {
      name: "a passed check keeps its code only",
      check: { name: "http_internal", status: "pass", httpStatus: 200, detail: "ok" },
      note: "200",
    },
    {
      name: "a long reason is its first line",
      check: {
        name: "http_public",
        status: "fail",
        detail: "connection refused\nhint: check the start command",
      },
      note: "connection refused",
    },
  ])("$name", ({ check, note }) => {
    const fields = buildVerifyFields(
      call(
        "zerops_verify",
        { serviceHostname: "apidev" },
        {
          hostname: "apidev",
          status: check.status === "pass" ? "healthy" : "unhealthy",
          checks: [check],
        },
      ),
    );
    expect(fields.steps[0]?.note).toBe(note);
  });
});

describe("buildDevServerFields — a dev server that did not come up says what its log said", () => {
  it("explains a server that is not running with its reason and the log's tail", () => {
    const fields = buildDevServerFields(
      call(
        "zerops_dev_server",
        { hostname: "nextstoredev", action: "start" },
        {
          action: "start",
          hostname: "nextstoredev",
          running: false,
          reason: "health_probe_timeout",
          logTail: "ready in 2s\nError: Cannot find module 'next'\n    at require (node:internal)",
        },
      ),
    );
    expect(fields.explanation).toEqual({
      reason: "Health probe timeout",
      logTail: [
        "ready in 2s",
        "Error: Cannot find module 'next'",
        "    at require (node:internal)",
      ],
    });
  });

  it("has nothing to explain for a server that runs", () => {
    const fields = buildDevServerFields(
      call(
        "zerops_dev_server",
        { hostname: "nextstoredev", action: "start" },
        {
          action: "start",
          hostname: "nextstoredev",
          running: true,
          port: 8000,
          logTail: "ready in 2s",
        },
      ),
    );
    expect(fields.explanation).toBeUndefined();
  });
});

describe("buildVerifyFields — the card names the service the checks ran on", () => {
  // zcp verifies a pair's stage when asked for its dev half (a push source):
  // the checks, and so the verdict, are the stage's.
  it.each([
    {
      name: "a dev half redirected to its stage names the stage",
      input: { serviceHostname: "webdev" },
      result: { hostname: "webstage", status: "unhealthy", checks: [] },
      subject: "webstage",
    },
    {
      name: "a service verified as asked names itself",
      input: { serviceHostname: "apidev" },
      result: { hostname: "apidev", status: "healthy", checks: [] },
      subject: "apidev",
    },
    {
      name: "a verify still running names the service asked for",
      input: { serviceHostname: "webdev" },
      result: undefined,
      subject: "webdev",
    },
    {
      name: "a verify of every service stays all services",
      input: {},
      result: { summary: "2/2 healthy", status: "healthy", services: [] },
      subject: "all services",
    },
  ])("$name", ({ input, result, subject }) => {
    const { resultText: _text, settledAt: _at, ...running } = call("zerops_verify", input, {});
    const fields = buildVerifyFields(
      result === undefined
        ? { ...running, status: "inProgress" }
        : call("zerops_verify", input, result),
    );
    expect(fields.subject).toBe(subject);
    expect(fields.target).toEqual({ hostname: subject });
  });
});
