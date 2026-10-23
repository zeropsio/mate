import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import live from "./__fixtures__/dev-server.live-three-servers.json" with { type: "json" };
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

// A log read checks nothing: zcp answers it with `running: false`, which read
// as a dev server that had stopped ("medusadev · not running" beside a dev
// that answered 200 a minute before).
describe("buildDevServerFields — a log read finds nothing about running", () => {
  it("reads as a read log, not as a server that is not running", () => {
    const fields = buildDevServerFields(
      call(
        "zerops_dev_server",
        { hostname: "medusadev", action: "logs" },
        { action: "logs", hostname: "medusadev", running: false, logTail: "Server is ready" },
      ),
    );
    expect(fields.statusWord).toBe("Read");
    expect(fields.closing).toBe("Read the medusadev log.");
    expect(fields.steps.map((step) => step.state)).not.toContain("failed");
    expect(fields.explanation).toBeUndefined();
  });
});

describe("buildDevServerFields — a service of several named dev servers", () => {
  it("shows each server zcp's live result names, with its port and state", () => {
    const fields = buildDevServerFields(
      call("zerops_dev_server", { hostname: "e1pnpm", action: "status", name: "web" }, live),
    );
    expect(fields.steps.map((step) => [step.label, step.stateLabel])).toEqual([
      ["web :3000", "Running"],
      ["api :8080", "Running"],
      ["worker", "Running"],
    ]);
    expect(fields.links).toEqual([
      { label: "web :3000", url: "https://e1pnpm-26a7-3000.prg1.zerops.app" },
      { label: "api :8080", url: "https://e1pnpm-26a7-8080.prg1.zerops.app" },
    ]);
  });

  it("shows each server zcp read on the lease the call named, with its pool address", () => {
    const readAt = "2026-10-23T12:00:00Z";
    const web = {
      name: "web",
      port: 3000,
      url: "https://webpool-29f-8003.ny1.zerops.app",
      status: "running",
      readAt,
    };
    const worker = { name: "worker", status: "starting", readAt };
    const fields = buildDevServerFields(
      call(
        "zerops_dev_server",
        { hostname: "webpool-3", action: "status", name: "web" },
        {
          action: "status",
          hostname: "webpool-3",
          name: "web",
          running: true,
          port: 3000,
          envelope: {
            phase: "develop-active",
            environment: "container",
            project: { id: "proj-1", name: "z3-eval" },
            services: [],
            leases: [
              { alias: "webpool-4", pool: "webpool", state: "held", devServers: [web, web] },
              { alias: "webpool-3", pool: "webpool", state: "held", devServers: [web, worker] },
            ],
            generated: readAt,
          },
        },
      ),
    );
    expect(fields.steps.map((step) => [step.label, step.stateLabel])).toEqual([
      ["web :3000", "Running"],
      ["worker", "Starting"],
    ]);
    expect(fields.links).toEqual([
      { label: "web :3000", url: "https://webpool-29f-8003.ny1.zerops.app" },
    ]);
  });

  it("reads an invalid-parameter answer as a failed call, never as a server that is not running", () => {
    const refusal = {
      code: "INVALID_PARAMETER",
      error: "e1pnpm declares several dev servers; name the one you mean",
    };
    const fields = buildDevServerFields({
      ...call("zerops_dev_server", { hostname: "e1pnpm", action: "status" }, refusal),
      status: "failed",
    });
    expect(fields.statusWord).not.toMatch(/not running/i);
    expect(fields.closing).not.toMatch(/did not come up|not running/i);
    expect(fields.closing).toContain("name the one you mean");
    expect(fields.refused).toBe(true);
  });
});

describe("buildDevServerFields — a lease with one dev server", () => {
  const readAt = "2026-10-23T12:00:00Z";
  const preview = {
    name: "web",
    port: 3000,
    url: "https://webpool-29f-8003.ny1.zerops.app",
    status: "running",
    readAt,
  };
  /** A healthy status of the one server on the lease `webpool-3`, its envelope reading `leases`. */
  const onLease = (leases: ReadonlyArray<Record<string, unknown>>, services: unknown[] = []) =>
    buildDevServerFields(
      call(
        "zerops_dev_server",
        { hostname: "webpool-3", action: "status" },
        {
          action: "status",
          hostname: "webpool-3",
          running: true,
          port: 3000,
          healthStatus: 200,
          envelope: {
            phase: "develop-active",
            environment: "container",
            project: { id: "proj-1", name: "z3-eval" },
            services,
            leases,
            generated: readAt,
          },
        },
      ),
    );

  it.each([
    {
      name: "opens the lease at the preview address zcp read on its one dev server",
      leases: [
        {
          alias: "webpool-4",
          pool: "webpool",
          state: "held",
          devServers: [{ ...preview, url: "https://webpool-29f-8004.ny1.zerops.app" }],
        },
        { alias: "webpool-3", pool: "webpool", state: "held", devServers: [preview] },
      ],
      links: [{ label: "Open", url: "https://webpool-29f-8003.ny1.zerops.app" }],
    },
    {
      name: "has no Open link where zcp read no address on the lease's one dev server",
      leases: [
        {
          alias: "webpool-3",
          pool: "webpool",
          state: "held",
          devServers: [{ name: "web", port: 3000, status: "running", readAt }],
        },
      ],
      links: [],
    },
    {
      name: "has no Open link where the call did not read the lease's dev servers",
      leases: [{ alias: "webpool-3", pool: "webpool", state: "held" }],
      links: [],
    },
  ])("$name", ({ leases, links }) => {
    const fields = onLease(leases);
    expect(fields.steps.map((step) => [step.label, step.state, step.note])).toEqual([
      ["Health check", "done", "HTTP 200"],
    ]);
    expect(fields.links).toEqual(links);
  });

  it("leaves a service's one dev server to the topology view's address, never the result's", () => {
    const fields = buildDevServerFields(
      call(
        "zerops_dev_server",
        { hostname: "appdev", action: "status" },
        {
          action: "status",
          hostname: "appdev",
          running: true,
          port: 3000,
          envelope: {
            phase: "develop-active",
            environment: "container",
            project: { id: "proj-1", name: "z3-eval" },
            services: [
              {
                hostname: "appdev",
                devServers: [
                  { ...preview, name: "appdev", url: "https://appdev-1df2-3000.prg1.zerops.app" },
                ],
              },
            ],
            leases: [{ alias: "webpool-3", pool: "webpool", state: "held", devServers: [preview] }],
            generated: readAt,
          },
        },
      ),
    );
    expect(fields.links).toEqual([]);
  });
});
