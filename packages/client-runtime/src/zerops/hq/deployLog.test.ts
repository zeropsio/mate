import { describe, expect, it } from "vite-plus/test";
import type { ActivityProcess } from "../activity/dto.ts";
import { inspectDeployLog, deployLogTarget } from "./deployLog.ts";

const TARGET = { jobId: "7", processId: "p7", appVersionId: "v7" };
const process = (over: Partial<ActivityProcess> = {}): ActivityProcess => ({
  id: "p7",
  projectId: "project-1",
  serviceStackIds: ["svc-1"],
  actionName: "appVersion.build",
  status: "RUNNING",
  created: "2026-10-04T10:00:00Z",
  appVersion: {
    id: "v7",
    status: "BUILDING",
    build: {
      serviceStackId: "builder-7",
      pipelineStart: "2026-10-04T10:00:00Z",
      startDate: "2026-10-04T10:00:01Z",
    },
  },
  ...over,
});
const NOW = Date.parse("2026-10-04T10:00:10Z");

describe("deploy log inspection", () => {
  it("keeps the durable handles of a deploy, and offers nothing without one", () => {
    expect(
      deployLogTarget({ id: "7", kind: "deploy", processId: "p7", appVersionId: "v7" }),
    ).toEqual(TARGET);
    expect(
      deployLogTarget({ id: "7", kind: "deploy", processId: null, appVersionId: "v7" }),
    ).toEqual({ ...TARGET, processId: null });
    expect(
      deployLogTarget({ id: "7", kind: "deploy", processId: null, appVersionId: null }),
    ).toBeUndefined();
    expect(
      deployLogTarget({ id: "7", kind: "delta", processId: "p7", appVersionId: null }),
    ).toBeUndefined();
  });

  it("reads the named process's pipeline and builder log, even beside a newer deploy", () => {
    const read = inspectDeployLog(
      TARGET,
      "project-1",
      [
        process({ id: "newer", created: "2026-10-04T10:00:05Z", appVersion: { id: "v8" } }),
        process(),
      ],
      NOW,
      "api",
    );
    expect(
      read?.pipeline.steps.some(
        (step) => step.id === "RUN_BUILD_COMMANDS" && step.state === "running",
      ),
    ).toBe(true);
    expect(read?.query).toEqual({
      buildServiceStackId: "builder-7",
      appVersionId: "v7",
      fromIso: "2026-10-04T09:59:55.000Z",
    });
    expect(read?.live).toBe(true);
  });

  it("uses the version handle only when no process was recorded", () => {
    expect(
      inspectDeployLog({ ...TARGET, processId: null }, "project-1", [process()], NOW, "api")?.query
        ?.appVersionId,
    ).toBe("v7");
    expect(
      inspectDeployLog(TARGET, "project-1", [process({ id: "other" })], NOW, "api"),
    ).toBeUndefined();
  });

  it("never borrows another project's or unrelated deploy's log", () => {
    expect(inspectDeployLog(TARGET, "other-project", [process()], NOW, "api")).toBeUndefined();
    expect(
      inspectDeployLog(
        TARGET,
        "project-1",
        [process({ id: "other", appVersion: { id: "v8" } })],
        NOW,
        "api",
      ),
    ).toBeUndefined();
  });

  it.each(["FAILED", "FINISHED"])(
    "keeps a settled %s deploy inspectable without following its log",
    (status) => {
      const read = inspectDeployLog(TARGET, "project-1", [process({ status })], NOW, "api");
      expect(read?.query?.appVersionId).toBe("v7");
      expect(read?.live).toBe(false);
    },
  );
});

it("stops following when the pipeline settled before the process status did", () => {
  expect(
    inspectDeployLog(
      TARGET,
      "project-1",
      [process({ appVersion: { id: "v7", status: "ACTIVE" } })],
      NOW,
      "api",
    )?.live,
  ).toBe(false);
});
