import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { describe, expect, it } from "vite-plus/test";

import { type DeployBuildsInput, deployBuildLookup } from "./useDeployBuilds";
import type { ProjectActivitySnapshot } from "./useProjectActivity";

const BUILDING: ActivityProcess = {
  id: "p1",
  projectId: "proj-1",
  serviceStackIds: ["svc-1"],
  status: "RUNNING",
  actionName: "stack.build",
  created: "2026-09-02T10:00:00.000Z",
  appVersion: { id: "av-1", status: "BUILDING" },
};
const READ: ProjectActivitySnapshot = {
  processes: [BUILDING],
  atMs: 1,
  live: true,
  processHistory: "read",
};
const input = (overrides: Partial<DeployBuildsInput>): DeployBuildsInput => ({
  signedIn: true,
  thread: { projectId: "proj-1" },
  project: "readable",
  snapshot: READ,
  ...overrides,
});

describe("deployBuildLookup — what the thread's project says of a build a deploy named", () => {
  it.each([
    { name: "the store read the project", input: input({}), expected: "running" },
    {
      name: "nothing read of it yet",
      input: input({ snapshot: { processes: undefined, atMs: undefined, live: false } }),
      expected: "unread",
    },
    {
      name: "the inventory still loading",
      input: input({ project: "loading" }),
      expected: "unread",
    },
    { name: "not signed in", input: input({ signedIn: false }), expected: "unobservable" },
    {
      name: "the thread's project still read",
      input: input({ thread: "reading" }),
      expected: "unread",
    },
    {
      name: "a thread with no project",
      input: input({ thread: "none" }),
      expected: "unobservable",
    },
    {
      name: "a project not readable here",
      input: input({ project: "unreadable" }),
      expected: "unobservable",
    },
    {
      name: "the store cannot read it",
      input: input({ snapshot: { ...READ, unavailableReason: "forbidden" } }),
      expected: "unobservable",
    },
  ] as const)("$name: $expected", ({ input: given, expected }) => {
    expect(deployBuildLookup(given)("av-1")).toBe(expected);
  });
});
