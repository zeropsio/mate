import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "./dto.ts";
import { type ProjectBuildsRead, readDeployBuild } from "./deployBuild.ts";

function build(overrides: Partial<ActivityProcess>): ActivityProcess {
  return {
    id: "p1",
    projectId: "proj-1",
    serviceStackIds: ["svc-1"],
    status: "RUNNING",
    actionName: "stack.build",
    created: "2026-09-02T10:00:00.000Z",
    appVersion: { id: "av-ours", status: "BUILDING" },
    ...overrides,
  };
}

const read = (
  processes: ReadonlyArray<ActivityProcess> | undefined,
  processHistory: ProjectBuildsRead["processHistory"] = "read",
): ProjectBuildsRead => ({ processes, processHistory });

describe("readDeployBuild — a deploy's build, by the appVersion its result named", () => {
  it.each([
    [
      "its pipeline deployed",
      read([build({ status: "FINISHED", appVersion: { id: "av-ours", status: "ACTIVE" } })]),
      "finished",
    ],
    [
      "its build failed",
      read([build({ status: "FAILED", appVersion: { id: "av-ours", status: "DEPLOY_FAILED" } })]),
      "failed",
    ],
    ["it was cancelled", read([build({ status: "CANCELED" })]), "failed"],
    ["it builds", read([build({})]), "running"],
    [
      "another build ended, ours builds",
      read([
        build({}),
        build({ id: "p2", status: "FINISHED", appVersion: { id: "av-other", status: "ACTIVE" } }),
      ]),
      "running",
    ],
    ["nothing read yet", read(undefined, "unread"), "unread"],
    ["not among what runs, its history still being read", read([], "reading"), "unread"],
    ["not among what runs nor in the history read", read([], "read"), "unobservable"],
    ["the history read failed", read([], "failed"), "unobservable"],
    ["the read is of another project", read([build({ projectId: "proj-2" })]), "unobservable"],
    ["the project cannot be read", "unobservable" as const, "unobservable"],
  ] as const)("%s", (_label, projectRead, expected) => {
    expect(readDeployBuild(projectRead, "proj-1", "av-ours")).toBe(expected);
  });
});
