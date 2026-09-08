import { processRecordToActivityProcess } from "@t3tools/client-runtime/zerops/data";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import type {
  ManagedZeropsDataRuntime,
  ProjectTopologyRead,
  UsageRead,
  ProcessRecord,
  HistoryReadView,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import { makeHistoryStore, makeUsageStore } from "./useProjectTopology";

describe("central topology binding", () => {
  it("preserves process status, service attribution and pipeline fields", () => {
    const record = {
      ref: { processId: "process-1", project: { projectId: "project-1" } },
      identity: {
        knowledge: "observed",
        fields: {
          actionName: "stack.deploy",
          createdAt: "2026-09-07T10:00:00.000Z",
          serviceIds: ["service-1"],
        },
      },
      lifecycle: {
        knowledge: "observed",
        fields: { status: "RUNNING", startedAt: "2026-09-07T10:00:01.000Z" },
      },
      pipeline: {
        knowledge: "observed",
        fields: {
          appVersion: {
            id: "version-1",
            status: "BUILDING",
            build: {
              serviceStackId: "builder-1",
              pipelineStart: "2026-09-07T10:00:02.000Z",
            },
          },
        },
      },
    } as unknown as ProcessRecord;

    expect(processRecordToActivityProcess(record)).toMatchObject({
      id: "process-1",
      projectId: "project-1",
      serviceStackIds: ["service-1"],
      status: "RUNNING",
      appVersion: {
        id: "version-1",
        status: "BUILDING",
        build: {
          serviceStackId: "builder-1",
          pipelineStart: "2026-09-07T10:00:02.000Z",
        },
      },
    });
  });
});

it("reconciles metric changes between topology render and subscription", () => {
  const registry = AtomRegistry.make();
  const metric = Atom.make({ value: null } as UsageRead);
  const initial = registry.get(metric);
  const runtime = { reads: { usage: () => metric } } as unknown as ManagedZeropsDataRuntime;
  const topology = {
    services: { value: [{ knowledge: "observed", record: { ref: { serviceId: "a" } } }] },
  } as unknown as ProjectTopologyRead;
  const store = makeUsageStore(registry, runtime, topology);
  const newer = {
    ...initial,
    value: {
      containers: 1,
      cpu: { used: 2, limit: 4 },
      memoryGb: { used: 1, limit: 2 },
      diskGb: { used: 1, limit: 10 },
    },
  };
  registry.set(metric, newer);
  let notices = 0;
  const release = store.subscribe(() => notices++);
  expect(store.getSnapshot().get("a")).toBe(newer);
  expect(notices).toBe(1);
  release();
  registry.dispose();
});

it("subscribes to history arriving after topology and releases the listener", () => {
  const registry = AtomRegistry.make();
  const series = Atom.make({ series: { status: "unresolved" } } as HistoryReadView);
  const runtime = { reads: { history: () => series } } as unknown as ManagedZeropsDataRuntime;
  const topology = {
    services: { value: [{ knowledge: "observed", record: { ref: { serviceId: "app" } } }] },
  } as unknown as ProjectTopologyRead;
  const store = makeHistoryStore(registry, runtime, topology, {
    timeGroupBy: "1h",
    limit: 24,
    timeZone: "UTC",
  });
  const newer = { series: { status: "observed" } } as HistoryReadView;
  registry.set(series, newer);
  let notices = 0;
  const release = store.subscribe(() => notices++);
  expect(store.getSnapshot().get("app")).toBe(newer);
  expect(notices).toBe(1);
  release();
  registry.set(series, { ...newer });
  expect(notices).toBe(1);
  registry.dispose();
});
