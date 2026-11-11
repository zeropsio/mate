import { describe, expect, it } from "vite-plus/test";

import { readActivityAppVersion, readActivityProcess } from "./dto.ts";

describe("readActivityAppVersion — what the pipeline readout reads", () => {
  it.each([
    {
      name: "the version's own birth and source",
      raw: { status: "BUILDING", created: "t0", source: "CLI" },
      expected: { status: "BUILDING", created: "t0", source: "CLI" },
    },
    {
      name: "the build container's creation start and service name",
      raw: {
        build: {
          pipelineStart: "t1",
          containerCreationStart: "t1b",
          serviceStackName: "build-appdev",
        },
      },
      expected: {
        build: {
          pipelineStart: "t1",
          containerCreationStart: "t1b",
          serviceStackName: "build-appdev",
        },
      },
    },
    {
      name: "the prepare container's creation start and service name",
      raw: {
        prepareCustomRuntime: {
          startDate: "t3",
          containerCreationStart: "t2",
          serviceStackName: "prepare-appdev",
        },
      },
      expected: {
        prepareCustomRuntime: {
          startDate: "t3",
          containerCreationStart: "t2",
          serviceStackName: "prepare-appdev",
        },
      },
    },
    {
      name: "a null, empty or mistyped field degrades to absent",
      raw: {
        created: null,
        source: "",
        build: { containerCreationStart: 42, serviceStackName: null },
        prepareCustomRuntime: { containerCreationStart: {}, serviceStackName: [] },
      },
      expected: { build: {}, prepareCustomRuntime: {} },
    },
  ])("$name", ({ raw, expected }) => {
    expect(readActivityAppVersion(raw)).toEqual(expected);
  });

  it("reads nothing from a value that is not a record", () => {
    expect(readActivityAppVersion("BUILDING")).toBeUndefined();
    expect(readActivityAppVersion(null)).toBeUndefined();
  });
});

describe("readActivityProcess", () => {
  it("reads a process with a full appVersion", () => {
    const process = readActivityProcess({
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
    });

    expect(process).toEqual({
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
    });
  });

  it("dedupes serviceStackId against serviceStacks[].id", () => {
    const process = readActivityProcess({
      id: "p1",
      projectId: "proj-1",
      serviceStackId: "svc-1",
      serviceStacks: [{ id: "svc-1" }, { id: "svc-2" }],
      status: "RUNNING",
      actionName: "stack.deploy",
      created: "2026-09-02T10:00:00.000Z",
    });

    expect(process?.serviceStackIds).toEqual(["svc-1", "svc-2"]);
  });

  it("reads a process with no appVersion at all", () => {
    const process = readActivityProcess({
      id: "p1",
      projectId: "proj-1",
      serviceStackId: "svc-1",
      status: "PENDING",
      actionName: "stack.deploy",
      created: "2026-09-02T10:00:00.000Z",
    });

    expect(process?.appVersion).toBeUndefined();
  });

  it.each([
    {
      name: "the platform's public reason",
      extra: { publicMeta: { failReason: "Out of disk" } },
      reason: "Out of disk",
    },
    {
      name: "its error, when the public reason is absent",
      extra: {
        error: { code: "serviceStackCreateFailed", message: "Type postgresql@99 is unknown" },
      },
      reason: "serviceStackCreateFailed: Type postgresql@99 is unknown",
    },
    {
      name: "an error with a code alone",
      extra: { error: { code: "quotaExceeded" } },
      reason: "quotaExceeded",
    },
    {
      name: "the public reason over the error",
      extra: { publicMeta: { failReason: "Out of disk" }, error: { code: "x" } },
      reason: "Out of disk",
    },
    { name: "nothing, for a process that says none", extra: {}, reason: undefined },
  ])("reads why a process failed: $name", ({ extra, reason }) => {
    const process = readActivityProcess({
      id: "p1",
      projectId: "proj-1",
      serviceStackId: "svc-1",
      status: "FAILED",
      actionName: "stack.create",
      created: "2026-09-02T10:00:00.000Z",
      ...extra,
    });
    expect(process?.failReason).toBe(reason);
  });

  it.each([
    {
      name: "its code and words",
      error: { code: "internalServerError", message: "Internal server error" },
      read: { code: "internalServerError", message: "Internal server error" },
    },
    { name: "its words alone", error: { message: "Gone" }, read: { code: "", message: "Gone" } },
    { name: "nothing, for an empty one", error: {}, read: undefined },
    { name: "nothing, for none", error: undefined, read: undefined },
  ])("keeps the error a process carries, as the platform gave it: $name", ({ error, read }) => {
    const process = readActivityProcess({
      id: "p1",
      projectId: "proj-1",
      status: "FAILED",
      actionName: "project.create",
      created: "2026-09-02T10:00:00.000Z",
      ...(error === undefined ? {} : { error }),
    });
    expect(process?.error).toEqual(read);
  });

  it("ignores a field the API adds that this build knows nothing about", () => {
    const process = readActivityProcess({
      id: "p1",
      projectId: "proj-1",
      serviceStackId: "svc-1",
      status: "RUNNING",
      actionName: "stack.deploy",
      created: "t",
      somethingNew: { nested: true },
      appVersion: { status: "BUILDING", somethingNew: 1 },
    });

    expect(process).toEqual({
      id: "p1",
      projectId: "proj-1",
      serviceStackIds: ["svc-1"],
      status: "RUNNING",
      actionName: "stack.deploy",
      created: "t",
      appVersion: { status: "BUILDING" },
    });
  });

  it("reads the observation fields the pipeline-with-durations port needs", () => {
    const process = readActivityProcess({
      id: "p1",
      projectId: "proj-1",
      serviceStackId: "svc-1",
      status: "RUNNING",
      actionName: "stack.deploy",
      created: "2026-09-02T10:00:00.000Z",
      started: "2026-09-02T10:00:01.000Z",
      finished: "2026-09-02T10:05:00.000Z",
      appVersion: {
        id: "av-1",
        status: "BUILDING",
        build: {
          pipelineStart: "t1",
          startDate: "t2",
          serviceStackId: "build-svc-1",
          pipelineFinish: "t9",
        },
        prepareCustomRuntime: { startDate: "t3", serviceStackId: "prepare-svc-1" },
      },
    });

    expect(process?.started).toBe("2026-09-02T10:00:01.000Z");
    expect(process?.finished).toBe("2026-09-02T10:05:00.000Z");
    expect(process?.appVersion?.id).toBe("av-1");
    expect(process?.appVersion?.build?.serviceStackId).toBe("build-svc-1");
    expect(process?.appVersion?.build?.pipelineFinish).toBe("t9");
    expect(process?.appVersion?.prepareCustomRuntime?.serviceStackId).toBe("prepare-svc-1");
  });

  it("decodes a process/appVersion with none of the new observation fields", () => {
    const process = readActivityProcess({
      id: "p1",
      projectId: "proj-1",
      serviceStackId: "svc-1",
      status: "RUNNING",
      actionName: "stack.deploy",
      created: "2026-09-02T10:00:00.000Z",
      appVersion: { status: "BUILDING" },
    });

    expect(process?.started).toBeUndefined();
    expect(process?.finished).toBeUndefined();
    expect(process?.appVersion?.id).toBeUndefined();
    expect(process?.appVersion?.build).toBeUndefined();
  });
});
