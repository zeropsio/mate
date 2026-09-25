import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall, ZeropsCallStatus } from "../types.ts";
import {
  buildDiscoverFields,
  buildEventsFields,
  buildLogsFields,
  buildProcessFields,
} from "./readTools.ts";

function call(
  toolName: string,
  status: ZeropsCallStatus,
  input: Record<string, unknown>,
  result?: unknown,
): ZeropsCall {
  return {
    id: "c1",
    turnId: "t1",
    toolName,
    input,
    status,
    ...(result === undefined
      ? {}
      : { resultText: typeof result === "string" ? result : JSON.stringify(result) }),
    truncated: false,
    startedAt: "2026-09-25T10:00:00.000Z",
    anchorActivityId: "a1",
    ...(status === "inProgress" ? {} : { settledAt: "2026-09-25T10:00:02.000Z" }),
    rowIds: new Set(["a1"]),
    agentInternal: false,
  };
}

const logEntry = (index: number, severity: string) => ({
  timestamp: `2026-09-25T10:00:${index.toString().padStart(2, "0")}Z`,
  severity,
  message: `line ${index}`,
  container: "app-1",
});

const FAILED_RESULT = { code: "SERVICE_NOT_FOUND", error: "Service 'app' not found" };

describe("buildLogsFields", () => {
  const filtered = { serviceHostname: "app", severity: "ERROR", since: "5m", search: "timeout" };
  const fourteen = [
    ...Array.from({ length: 11 }, (_, i) => logEntry(i, "Informational")),
    logEntry(11, "Warning"),
    logEntry(12, "Error"),
    logEntry(13, "Critical"),
  ];

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly call: ZeropsCall;
    readonly expected: Record<string, unknown>;
  }> = [
    {
      name: "draws the final shape empty while the call runs",
      call: call("zerops_logs", "inProgress", filtered),
      expected: {
        subject: "app",
        voice: "Reading the app log.",
        statusWord: "Reading",
        readResult: {
          kind: "logs",
          pending: true,
          service: "app",
          filter: "errors · since 5m · “timeout”",
          lines: [],
        },
      },
    },
    {
      name: "names the service generically before the arguments arrive",
      call: call("zerops_logs", "inProgress", {}),
      expected: {
        subject: "the service",
        readResult: { kind: "logs", pending: true, service: "the service", lines: [] },
      },
    },
    {
      name: "keeps the last 12 lines, counts every line, and says it capped",
      call: call(
        "zerops_logs",
        "completed",
        { serviceHostname: "app" },
        {
          entries: fourteen,
          hasMore: false,
        },
      ),
      expected: {
        voice: "Reading the app log.",
        statusWord: "Read",
        readResult: {
          kind: "logs",
          pending: false,
          service: "app",
          lines: fourteen.slice(2).map((entry, i) => ({
            id: `${i + 2}`,
            at: entry.timestamp,
            severity:
              entry.severity === "Warning"
                ? "warning"
                : entry.severity === "Informational"
                  ? "info"
                  : "error",
            text: entry.message,
          })),
          counts: "2 errors · 1 warning",
          note: "Showing the last 12 of 14 lines.",
        },
      },
    },
    {
      name: "says older lines exist when zcp had more than it returned",
      call: call(
        "zerops_logs",
        "completed",
        { serviceHostname: "app" },
        {
          entries: [logEntry(1, "Warning")],
          hasMore: true,
        },
      ),
      expected: {
        readResult: {
          kind: "logs",
          pending: false,
          service: "app",
          lines: [
            { id: "0", at: logEntry(1, "Warning").timestamp, severity: "warning", text: "line 1" },
          ],
          counts: "0 errors · 1 warning",
          note: "Older lines were not fetched.",
        },
      },
    },
    {
      name: "carries zcp's reason for an empty log",
      call: call(
        "zerops_logs",
        "completed",
        { serviceHostname: "app" },
        {
          entries: [],
          hasMore: false,
          emptyReason: "The service has never been deployed.",
        },
      ),
      expected: {
        readResult: {
          kind: "logs",
          pending: false,
          service: "app",
          lines: [],
          note: "The service has never been deployed.",
        },
      },
    },
    {
      name: "reads as the error card once the call failed, its voice kept",
      call: call("zerops_logs", "failed", { serviceHostname: "app" }, FAILED_RESULT),
      expected: {
        voice: "Reading the app log.",
        kicker: "Error · SERVICE_NOT_FOUND",
        statusWord: "Failed",
        closing: "Service 'app' not found",
        phaseOverride: "failed",
      },
    },
  ];
  for (const { name, call: input, expected } of cases) {
    it(name, () => {
      expect(buildLogsFields(input)).toMatchObject(expected);
    });
  }

  it("has no read result once the call settled without one, or failed", () => {
    expect(
      buildLogsFields(call("zerops_logs", "interrupted", { serviceHostname: "app" })),
    ).not.toHaveProperty("readResult");
    expect(
      buildLogsFields(call("zerops_logs", "failed", { serviceHostname: "app" }, FAILED_RESULT)),
    ).not.toHaveProperty("readResult");
  });
});

describe("buildEventsFields", () => {
  const event = (index: number, status: string, action = "build") => ({
    timestamp: `2026-09-25T10:${(59 - index).toString().padStart(2, "0")}:00Z`,
    type: "process",
    action,
    status,
    service: "app",
  });
  const ten = Array.from({ length: 10 }, (_, i) => event(i, "FINISHED"));

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly call: ZeropsCall;
    readonly expected: Record<string, unknown>;
  }> = [
    {
      name: "draws the final shape empty while the call runs, scoped to the project",
      call: call("zerops_events", "inProgress", {}),
      expected: {
        subject: "the project",
        voice: "Reading recent events of the project.",
        statusWord: "Reading",
        readResult: { kind: "events", pending: true, rows: [] },
      },
    },
    {
      name: "keeps the newest 8 and counts the rest",
      call: call("zerops_events", "completed", { serviceHostname: "app" }, { events: ten }),
      expected: {
        subject: "app",
        statusWord: "Read",
        readResult: {
          kind: "events",
          pending: false,
          rows: ten.slice(0, 8).map((entry, i) => ({
            id: `${i}`,
            at: entry.timestamp,
            service: "app",
            action: "Build",
            status: { word: "Done", tone: "ok" },
          })),
          more: "2 more",
        },
      },
    },
    {
      name: "words each status and action for people, each with its tone",
      call: call(
        "zerops_events",
        "completed",
        {},
        {
          events: [
            event(0, "BUILD_FAILED"),
            event(1, "DEPLOY_FAILED", "deploy"),
            event(2, "RUNNING", "stack.enableSubdomainAccess"),
            event(3, "PENDING", "subdomain-enable"),
            event(4, "CANCELED", "env-update"),
          ],
        },
      ),
      expected: {
        readResult: {
          kind: "events",
          pending: false,
          rows: [
            expect.objectContaining({
              action: "Build",
              status: { word: "Failed", tone: "failed" },
            }),
            expect.objectContaining({
              action: "Deploy",
              status: { word: "Deploy failed", tone: "failed" },
            }),
            expect.objectContaining({
              action: "Enable subdomain access",
              status: { word: "Running", tone: "busy" },
            }),
            expect.objectContaining({
              action: "Subdomain enable",
              status: { word: "Pending", tone: "busy" },
            }),
            expect.objectContaining({
              action: "Env update",
              status: { word: "Canceled", tone: "off" },
            }),
          ],
        },
      },
    },
  ];
  for (const { name, call: input, expected } of cases) {
    it(name, () => {
      expect(buildEventsFields(input)).toMatchObject(expected);
    });
  }
});

describe("buildProcessFields", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly call: ZeropsCall;
    readonly expected: Record<string, unknown>;
  }> = [
    {
      name: "waits on a service, the final shape empty while it runs",
      call: call("zerops_process", "inProgress", { action: "wait", service: "app" }),
      expected: {
        subject: "the work on app",
        voice: "Following the work on app.",
        statusWord: "Waiting",
        steps: [],
        readResult: { kind: "process", pending: true },
      },
    },
    {
      name: "checks one process by id",
      call: call("zerops_process", "inProgress", { processId: "p-1" }),
      expected: { subject: "a process", statusWord: "Checking" },
    },
    {
      name: "cancels a process",
      call: call("zerops_process", "inProgress", { processId: "p-1", action: "cancel" }),
      expected: { statusWord: "Canceling" },
    },
    {
      name: "waits on several processes",
      call: call("zerops_process", "inProgress", { action: "wait", processIds: ["a", "b"] }),
      expected: { subject: "2 processes" },
    },
    {
      name: "draws each process as a step and says a failed one in the status word",
      call: call(
        "zerops_process",
        "completed",
        { action: "wait", service: "app" },
        {
          processes: [
            { processId: "a", actionName: "stack.build", status: "FINISHED" },
            {
              processId: "b",
              actionName: "stack.enableSubdomainAccess",
              status: "FAILED",
              failReason: "port 3000 not open",
            },
          ],
          settled: true,
          message: "1 of 2 processes failed.",
        },
      ),
      expected: {
        statusWord: "Process failed",
        closing: "1 of 2 processes failed.",
        steps: [
          { id: "a", label: "Build", state: "done", stateLabel: "Done" },
          {
            id: "b",
            label: "Enable subdomain access",
            state: "failed",
            stateLabel: "Failed",
            note: "port 3000 not open",
          },
        ],
        readResult: { kind: "process", pending: false },
      },
    },
    {
      name: "says a wait that gave up is still running",
      call: call(
        "zerops_process",
        "completed",
        { action: "wait", service: "app" },
        {
          processes: [{ processId: "a", actionName: "stack.build", status: "RUNNING" }],
          settled: false,
          timedOut: true,
          message: "Still running after 15m.",
        },
      ),
      expected: {
        statusWord: "Still running",
        steps: [{ id: "a", label: "Build", state: "running", stateLabel: "Running" }],
      },
    },
    {
      name: "says a cancel landed",
      call: call(
        "zerops_process",
        "completed",
        { processId: "a", action: "cancel" },
        {
          processId: "a",
          status: "CANCELED",
          message: "Process a canceled",
        },
      ),
      expected: { statusWord: "Canceled", closing: "Process a canceled" },
    },
    {
      name: "reads a finished status check as done, with no closing line",
      call: call(
        "zerops_process",
        "completed",
        { processId: "a" },
        {
          processId: "a",
          actionName: "stack.build",
          status: "FINISHED",
          created: "2026-09-25T10:00:00Z",
        },
      ),
      expected: { statusWord: "Done", steps: [{ id: "a", label: "Build", state: "done" }] },
    },
  ];
  for (const { name, call: input, expected } of cases) {
    it(name, () => {
      expect(buildProcessFields(input)).toMatchObject(expected);
    });
  }

  it("draws no closing line for a status check, which carries no message", () => {
    expect(
      buildProcessFields(
        call(
          "zerops_process",
          "completed",
          { processId: "a" },
          {
            processId: "a",
            actionName: "stack.build",
            status: "FINISHED",
          },
        ),
      ),
    ).not.toHaveProperty("closing");
  });
});

describe("buildDiscoverFields", () => {
  const service = (overrides: Record<string, unknown>) => ({
    serviceId: "s",
    type: "nodejs@22",
    status: "ACTIVE",
    adoptionState: "adopted",
    isInfrastructure: false,
    ...overrides,
  });

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly call: ZeropsCall;
    readonly expected: Record<string, unknown>;
  }> = [
    {
      name: "draws the final shape empty while the call runs, over the whole project",
      call: call("zerops_discover", "inProgress", {}),
      expected: {
        subject: "the project's services",
        voice: "Looking at the project's services.",
        statusWord: "Reading",
        readResult: { kind: "discover", pending: true, rows: [] },
      },
    },
    {
      name: "names the one service it was asked about",
      call: call("zerops_discover", "inProgress", { service: "app" }),
      expected: { subject: "app", voice: "Looking at app." },
    },
    {
      name: "draws every service with its status word, tone, type and a note where it has one",
      call: call(
        "zerops_discover",
        "completed",
        {},
        {
          project: { id: "p", name: "weatherdash" },
          services: [
            service({ hostname: "app", type: "ubuntu/nodejs@22", adoptionState: "adoptable" }),
            service({ hostname: "appdev", status: "READY_TO_DEPLOY", adoptionState: "resumable" }),
            service({ hostname: "api", status: "BUILD_FAILED" }),
            service({ hostname: "web", status: "UPGRADING", adoptionState: "bootstrapping" }),
            service({
              hostname: "db",
              type: "postgresql@16",
              adoptionState: "managed-dep",
              isInfrastructure: true,
            }),
            service({ hostname: "zcp", type: "zcp@1", adoptionState: "zcp-self" }),
            service({ hostname: "old", status: "STOPPED" }),
          ],
        },
      ),
      expected: {
        statusWord: "Listed",
        readResult: {
          kind: "discover",
          pending: false,
          rows: [
            {
              hostname: "app",
              type: "nodejs@22",
              status: { word: "Active", tone: "ok" },
              note: "Can be adopted",
            },
            {
              hostname: "appdev",
              type: "nodejs@22",
              status: { word: "Ready to deploy", tone: "off" },
              note: "Setup unfinished",
            },
            {
              hostname: "api",
              type: "nodejs@22",
              status: { word: "Build failed", tone: "failed" },
            },
            {
              hostname: "web",
              type: "nodejs@22",
              status: { word: "Upgrading", tone: "busy" },
              note: "Being set up",
            },
            {
              hostname: "db",
              type: "postgresql@16",
              status: { word: "Active", tone: "ok" },
              note: "Managed",
            },
            {
              hostname: "zcp",
              type: "zcp@1",
              status: { word: "Active", tone: "ok" },
              note: "Zerops Control Plane",
            },
            { hostname: "old", type: "nodejs@22", status: { word: "Stopped", tone: "off" } },
          ],
        },
      },
    },
  ];
  for (const { name, call: input, expected } of cases) {
    it(name, () => {
      expect(buildDiscoverFields(input)).toMatchObject(expected);
    });
  }

  it("draws no note for an adopted service", () => {
    const fields = buildDiscoverFields(
      call(
        "zerops_discover",
        "completed",
        {},
        { project: {}, services: [service({ hostname: "a" })] },
      ),
    );
    expect(fields.readResult?.kind === "discover" && fields.readResult.rows[0]).not.toHaveProperty(
      "note",
    );
  });
});
