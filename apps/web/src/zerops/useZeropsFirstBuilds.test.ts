import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import { firstBuildsOf, firstBuildTargets } from "@t3tools/client-runtime/data";

const candidate = (key: string, status: string | undefined) =>
  ({
    key,
    project: { id: `project-${key}` },
    ...(status === undefined ? {} : { service: { id: `service-${key}`, name: "zcp", status } }),
  }) as Pick<ZeropsCandidate, "key" | "project" | "service">;

const build = (serviceId: string, status: string, created: string, failReason?: string) => ({
  actionName: "stack.build",
  serviceStackIds: [serviceId],
  status,
  created,
  ...(failReason === undefined ? {} : { failReason }),
});

describe("firstBuildTargets", () => {
  it("reads only a container waiting for its first build", () => {
    expect(
      firstBuildTargets([
        candidate("a", "READY_TO_DEPLOY"),
        candidate("b", "ACTIVE"),
        candidate("c", undefined),
      ]),
    ).toEqual([{ key: "a", projectId: "project-a", serviceId: "service-a" }]);
  });
});

describe("firstBuildsOf", () => {
  const targets = firstBuildTargets([
    candidate("a", "READY_TO_DEPLOY"),
    candidate("b", "READY_TO_DEPLOY"),
    candidate("c", "READY_TO_DEPLOY"),
  ]);
  const processes = {
    // Retried: its newest build is the one that says.
    "project-a": [
      build("service-a", "FAILED", "2026-10-05T10:00:00Z", "first try"),
      build("service-a", "RUNNING", "2026-10-05T10:05:00Z"),
    ],
    "project-b": [build("service-b", "CANCELED", "2026-10-05T10:00:00Z", "Build cancelled")],
  } as const;

  it("says each first build as its newest process does, and nothing where none is read", () => {
    expect(
      firstBuildsOf(targets, (projectId) => processes[projectId as keyof typeof processes]),
    ).toEqual(
      new Map([
        ["a", { kind: "running" }],
        ["b", { kind: "failed", why: "Build cancelled" }],
      ]),
    );
  });
});
