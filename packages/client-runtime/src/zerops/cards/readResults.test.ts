import { describe, expect, it } from "vite-plus/test";

import { readZeropsCardSource } from "./decode.ts";
import { decodeZeropsCard } from "./payloads.ts";

const card = (toolName: string, body: unknown, failed = false) =>
  decodeZeropsCard(
    readZeropsCardSource(
      { toolName, resultText: typeof body === "string" ? body : JSON.stringify(body) },
      { failed },
    ),
  );

describe("decodeZeropsCard — zerops_logs (`internal/ops/logs.go` `LogsResult`)", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly body: unknown;
    readonly expected: unknown;
  }> = [
    {
      name: "reads the entries in the order zcp sent them (oldest first)",
      body: {
        entries: [
          {
            timestamp: "2026-09-25T10:00:00Z",
            severity: "Informational",
            message: "listening on :3000",
            container: "app-1",
          },
          { timestamp: "2026-09-25T10:00:05Z", severity: "Error", message: "boom" },
        ],
        hasMore: true,
      },
      expected: {
        kind: "logs",
        entries: [
          {
            timestamp: "2026-09-25T10:00:00Z",
            severity: "Informational",
            message: "listening on :3000",
          },
          { timestamp: "2026-09-25T10:00:05Z", severity: "Error", message: "boom" },
        ],
        hasMore: true,
      },
    },
    {
      name: "keeps the empty-result explanation",
      body: {
        entries: [],
        hasMore: false,
        serviceStatus: "READY_TO_DEPLOY",
        emptyReason: "The service has never been deployed, so it has no runtime log.",
      },
      expected: {
        kind: "logs",
        entries: [],
        hasMore: false,
        emptyReason: "The service has never been deployed, so it has no runtime log.",
      },
    },
    {
      name: "drops an entry with no message",
      body: { entries: [{ timestamp: "2026-09-25T10:00:00Z", severity: "Error" }], hasMore: false },
      expected: { kind: "logs", entries: [], hasMore: false },
    },
  ];
  for (const { name, body, expected } of cases) {
    it(name, () => {
      expect(card("zerops_logs", body)).toEqual(expected);
    });
  }

  it("has no card for a document without entries", () => {
    expect(card("zerops_logs", { lines: ["hello"] })).toBeUndefined();
  });
});

describe("decodeZeropsCard — zerops_events (`internal/ops/events.go` `EventsResult`)", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly body: unknown;
    readonly expected: unknown;
  }> = [
    {
      name: "reads the timeline newest first, as zcp sends it",
      body: {
        projectId: "p1",
        events: [
          {
            timestamp: "2026-09-25T10:05:00Z",
            type: "build",
            action: "build",
            status: "BUILD_FAILED",
            service: "app",
            failureCause: "npm ci failed",
          },
          {
            timestamp: "2026-09-25T10:00:00Z",
            type: "process",
            action: "subdomain-enable",
            status: "FINISHED",
            service: "app",
            processId: "proc-1",
          },
        ],
        summary: { total: 2, processes: 1, deploys: 1 },
      },
      expected: {
        kind: "events",
        events: [
          {
            timestamp: "2026-09-25T10:05:00Z",
            action: "build",
            status: "BUILD_FAILED",
            service: "app",
          },
          {
            timestamp: "2026-09-25T10:00:00Z",
            action: "subdomain-enable",
            status: "FINISHED",
            service: "app",
            processId: "proc-1",
          },
        ],
      },
    },
    {
      name: "drops an event with no action or no status",
      body: { events: [{ action: "build" }, { status: "FINISHED" }] },
      expected: { kind: "events", events: [] },
    },
  ];
  for (const { name, body, expected } of cases) {
    it(name, () => {
      expect(card("zerops_events", body)).toEqual(expected);
    });
  }

  it("has no card for a document without events", () => {
    expect(card("zerops_events", { projectId: "p1" })).toBeUndefined();
  });
});

describe("decodeZeropsCard — zerops_process (`internal/ops/process.go`)", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly body: unknown;
    readonly expected: unknown;
  }> = [
    {
      name: "reads action=status (`ProcessStatusResult`) as one process",
      body: {
        processId: "proc-1",
        actionName: "stack.build",
        status: "FAILED",
        created: "2026-09-25T10:00:00Z",
        failReason: "build command exited 1",
      },
      expected: {
        kind: "process",
        processes: [
          {
            processId: "proc-1",
            action: "stack.build",
            status: "FAILED",
            failReason: "build command exited 1",
          },
        ],
        timedOut: false,
      },
    },
    {
      name: "reads action=wait (`WaitResult`) with every process it waited on",
      body: {
        processes: [
          { processId: "proc-1", actionName: "stack.build", status: "FINISHED" },
          { processId: "proc-2", actionName: "stack.enableSubdomainAccess", status: "RUNNING" },
        ],
        settled: false,
        timedOut: true,
        message: "Still running after 15m.",
      },
      expected: {
        kind: "process",
        processes: [
          { processId: "proc-1", action: "stack.build", status: "FINISHED" },
          { processId: "proc-2", action: "stack.enableSubdomainAccess", status: "RUNNING" },
        ],
        settled: false,
        timedOut: true,
        message: "Still running after 15m.",
      },
    },
    {
      name: "reads action=cancel (`ProcessCancelResult`)",
      body: { processId: "proc-1", status: "CANCELED", message: "Process proc-1 canceled" },
      expected: {
        kind: "process",
        processes: [{ processId: "proc-1", status: "CANCELED" }],
        timedOut: false,
        message: "Process proc-1 canceled",
      },
    },
  ];
  for (const { name, body, expected } of cases) {
    it(name, () => {
      expect(card("zerops_process", body)).toEqual(expected);
    });
  }

  it("has no card for a document that is neither shape", () => {
    expect(card("zerops_process", { settled: true })).toBeUndefined();
  });
});

describe("decodeZeropsCard — zerops_discover (`internal/ops/discover.go` `DiscoverResult`)", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly body: unknown;
    readonly expected: unknown;
  }> = [
    {
      name: "reads every service with its type, status and adoption state",
      body: {
        project: { id: "p1", name: "weatherdash", status: "ACTIVE" },
        services: [
          {
            hostname: "app",
            serviceId: "s1",
            type: "nodejs@22",
            status: "ACTIVE",
            adoptionState: "adoptable",
            isInfrastructure: false,
            subdomainUrl: "https://app.zerops.app",
          },
          {
            hostname: "db",
            serviceId: "s2",
            type: "postgresql@16",
            status: "ACTIVE",
            adoptionState: "managed-dep",
            isInfrastructure: true,
          },
        ],
        warnings: ["Services with adoptionState=adoptable …"],
      },
      expected: {
        kind: "discover",
        projectName: "weatherdash",
        services: [
          {
            hostname: "app",
            type: "nodejs@22",
            status: "ACTIVE",
            adoptionState: "adoptable",
            isInfrastructure: false,
          },
          {
            hostname: "db",
            type: "postgresql@16",
            status: "ACTIVE",
            adoptionState: "managed-dep",
            isInfrastructure: true,
          },
        ],
        warnings: ["Services with adoptionState=adoptable …"],
      },
    },
    {
      name: "reads an empty project",
      body: { project: { id: "p1", name: "empty" }, services: [] },
      expected: { kind: "discover", projectName: "empty", services: [], warnings: [] },
    },
    {
      name: "drops a service with no hostname or no status",
      body: { project: {}, services: [{ hostname: "app" }, { status: "ACTIVE" }] },
      expected: { kind: "discover", services: [], warnings: [] },
    },
  ];
  for (const { name, body, expected } of cases) {
    it(name, () => {
      expect(card("zerops_discover", body)).toEqual(expected);
    });
  }

  it("has no card for a document without services", () => {
    expect(card("zerops_discover", { project: { id: "p1" } })).toBeUndefined();
  });
});

describe("decodeZeropsCard — a failed read call", () => {
  it("is the error card, never the read payload", () => {
    expect(
      card("zerops_logs", { code: "SERVICE_NOT_FOUND", error: "No service app" }, true),
    ).toMatchObject({ kind: "error", code: "SERVICE_NOT_FOUND" });
  });
});
