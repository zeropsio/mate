import { describe, expect, it } from "vite-plus/test";

import { readProjectProcesses } from "./dto.ts";

describe("readProjectProcesses", () => {
  it("reads a process with a full appVersion", () => {
    const processes = readProjectProcesses({
      list: [
        {
          id: "p1",
          projectId: "proj-1",
          serviceStackId: "svc-1",
          serviceStacks: [{ id: "svc-1" }],
          status: "RUNNING",
          actionName: "stack.deploy",
          created: "2026-09-02T10:00:00.000Z",
          appVersion: {
            status: "BUILDING",
            build: { pipelineStart: "t1", startDate: "t2" },
            prepareCustomRuntime: { startDate: "t3" },
            activationDate: "t4",
          },
        },
      ],
    });

    expect(processes).toEqual([
      {
        id: "p1",
        projectId: "proj-1",
        serviceStackIds: ["svc-1"],
        status: "RUNNING",
        actionName: "stack.deploy",
        created: "2026-09-02T10:00:00.000Z",
        appVersion: {
          status: "BUILDING",
          build: { pipelineStart: "t1", startDate: "t2" },
          prepareCustomRuntime: { startDate: "t3" },
          activationDate: "t4",
        },
      },
    ]);
  });

  it("dedupes serviceStackId against serviceStacks[].id", () => {
    const processes = readProjectProcesses({
      list: [
        {
          id: "p1",
          projectId: "proj-1",
          serviceStackId: "svc-1",
          serviceStacks: [{ id: "svc-1" }, { id: "svc-2" }],
          status: "RUNNING",
          actionName: "stack.deploy",
          created: "2026-09-02T10:00:00.000Z",
        },
      ],
    });

    expect(processes?.[0]?.serviceStackIds).toEqual(["svc-1", "svc-2"]);
  });

  it("reads a process with no appVersion at all", () => {
    const processes = readProjectProcesses({
      list: [
        {
          id: "p1",
          projectId: "proj-1",
          serviceStackId: "svc-1",
          status: "PENDING",
          actionName: "stack.deploy",
          created: "2026-09-02T10:00:00.000Z",
        },
      ],
    });

    expect(processes?.[0]?.appVersion).toBeUndefined();
  });

  it("drops a process entry missing an identifying field, keeping the rest", () => {
    const processes = readProjectProcesses({
      list: [
        { id: "p1", status: "RUNNING", actionName: "stack.deploy", created: "t" },
        {
          id: "p2",
          projectId: "proj-1",
          status: "RUNNING",
          actionName: "stack.deploy",
          created: "t",
        },
      ],
    });

    expect(processes).toHaveLength(1);
    expect(processes?.[0]?.id).toBe("p2");
  });

  it("ignores a field the API adds that this build knows nothing about", () => {
    const processes = readProjectProcesses({
      list: [
        {
          id: "p1",
          projectId: "proj-1",
          serviceStackId: "svc-1",
          status: "RUNNING",
          actionName: "stack.deploy",
          created: "t",
          somethingNew: { nested: true },
          appVersion: { status: "BUILDING", somethingNew: 1 },
        },
      ],
    });

    expect(processes?.[0]).toEqual({
      id: "p1",
      projectId: "proj-1",
      serviceStackIds: ["svc-1"],
      status: "RUNNING",
      actionName: "stack.deploy",
      created: "t",
      appVersion: { status: "BUILDING" },
    });
  });

  it("returns an empty array for a valid empty list, distinct from no observation", () => {
    expect(readProjectProcesses({ list: [] })).toEqual([]);
  });

  it("returns undefined for a document with no readable list — no observation", () => {
    expect(readProjectProcesses({})).toBeUndefined();
    expect(readProjectProcesses({ list: "not-an-array" })).toBeUndefined();
    expect(readProjectProcesses(undefined)).toBeUndefined();
    expect(readProjectProcesses(null)).toBeUndefined();
    expect(readProjectProcesses("not a record")).toBeUndefined();
  });
});
