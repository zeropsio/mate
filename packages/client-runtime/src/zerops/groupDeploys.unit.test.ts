import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type { HqNavigationEnvironment, HqNavigationJob } from "@t3tools/shared/hqStream";
import { expect, it } from "vite-plus/test";

import { canonicalEnvironmentRowInputsOf } from "./groupDeploys.ts";

// witness: packages/client-runtime/src/zerops/groupDeploys.ts | job.state === "refused" ? { refused: true } : {} → job.state === "failed" ? { refused: true } : {}
it("ZV188: A release's creation HQ refused is told apart from one Zerops failed or left unresolved, by HQ's job state alone; breaks: a person is told Zerops could not create a service HQ never asked Zerops for.", () => {
  const job: HqNavigationJob = {
    id: "job-1",
    kind: "delta",
    service: null,
    sha: null,
    state: "refused",
    cause: "release",
    ref: "v0.1.0",
    reason: "The setup is missing",
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-11-25T21:13:49Z",
    endedAt: "2026-11-25T21:13:49Z",
    supersededBy: null,
    services: ["app"],
  };
  const environment: HqNavigationEnvironment = {
    id: HqEnvironmentId.make("production"),
    target: { kind: "zerops", projectId: ProjectId.make("project") },
    tier: "production",
    name: "production",
    sources: ["release"],
    order: 1,
    keyHeld: true,
    keyInvalid: false,
    jobs: [],
    release: null,
    birth: null,
  };
  const rows = [
    ["refused", { state: "failed", refused: true }],
    ["failed", { state: "failed" }],
    ["unresolved", { state: "failed" }],
    ["live", { state: "created" }],
  ] as const;
  for (const [state, expected] of rows) {
    const [row] = canonicalEnvironmentRowInputsOf({
      environments: [{ ...environment, jobs: [{ ...job, state }] }],
      projectNames: new Map(),
      services: [],
      versions: new Map(),
    });
    expect(row?.releaseCreations).toEqual([
      {
        tag: "v0.1.0",
        ...expected,
        reason: "The setup is missing",
        services: ["app"],
        at: "2026-11-25T21:13:49Z",
        endedAt: "2026-11-25T21:13:49Z",
      },
    ]);
  }
});
