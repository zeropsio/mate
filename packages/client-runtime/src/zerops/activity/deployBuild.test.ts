import type { ZeropsLifecycle } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { Known } from "../knowledge/index.ts";

import type { ActivityProcess } from "./dto.ts";
import { type ProjectBuildsRead, readDeployBuild, threadProjectOf } from "./deployBuild.ts";

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

describe("threadProjectOf — the project a thread's builds are read in", () => {
  const known = (projectId: string | undefined): Known<ZeropsLifecycle> => ({
    state: "known",
    value: {
      threadId: "thread-1",
      recentTools: [],
      ...(projectId === undefined
        ? {}
        : { envelope: { phase: "develop-active", project: { id: projectId, name: "p" } } }),
    } as unknown as ZeropsLifecycle,
    asOf: { ordinal: 1, atMs: 0 } as never,
    coverage: "complete",
    freshness: { kind: "live" },
  });

  it.each([
    ["its envelope names it", known("proj-1"), { projectId: "proj-1" }],
    ["its lifecycle still unread", { state: "unread", waitingFor: null } as const, "reading"],
    ["its lifecycle being read", { state: "reading", sinceMs: 0, attempt: 1 } as const, "reading"],
    ["its envelope names none", known(undefined), "none"],
    ["no lifecycle feed", undefined, "none"],
  ] as const)("%s", (_label, lifecycle, expected) => {
    expect(threadProjectOf(lifecycle as Known<ZeropsLifecycle> | undefined)).toEqual(expected);
  });
});
