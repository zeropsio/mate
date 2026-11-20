import { HqEnvironmentId } from "@t3tools/contracts";
import type { Release } from "@t3tools/shared/hqRelease";
import type { HqPushNavigationJob } from "@t3tools/shared/hqStream";
import { expect, it } from "vite-plus/test";

import { type GitDeliveryEnvironment, gitDeliveryOf } from "./gitDelivery.ts";

const SHA = "c".repeat(40);
const BEFORE = "d".repeat(40);
const AT = "2026-11-01T08:00:00Z";
const target = { kind: "git", branch: "main", delivery: "direct" } as const;
const releaseTarget = { environmentId: HqEnvironmentId.make("prod-git"), createdAt: AT, target };
const remote = {
  url: "https://git.example.test/shop/repo.git",
  repositoryId: "7",
  keptAt: AT,
  keptBy: "keeper",
  expiresAt: null,
  invalidSince: null,
  via: "token" as const,
  githubAppId: null,
};

const release: Release = {
  tag: "v2.0.0",
  sha: SHA,
  entries: [
    { service: "api", sha: SHA },
    { service: "web", sha: SHA },
  ],
  target: "git",
  releaseTarget,
  by: "releaser",
  at: AT,
  state: "approved",
  reason: null,
  rollbackOf: null,
};

/** A push HQ confirmed: the branch's head moved to the commit. */
const pushed = (service: string, tag: string): HqPushNavigationJob => ({
  id: `${tag}/${service}`,
  kind: "push",
  service,
  sha: SHA,
  state: "pushed",
  cause: "release",
  ref: tag,
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: "releaser",
  at: AT,
  endedAt: AT,
  supersededBy: null,
  evidence: {
    attempt: {
      remote,
      ref: "refs/heads/main",
      sha: SHA,
      before: BEFORE,
      credentialKeptAt: AT,
      phase: "submitting",
    },
    confirmed: {
      remote,
      ref: "refs/heads/main",
      before: BEFORE,
      after: SHA,
      at: AT,
      via: "answer",
    },
    nextActor: "none",
    nextAction: "Nothing to do",
  },
});

const environment = (jobs: ReadonlyArray<HqPushNavigationJob>): GitDeliveryEnvironment => ({
  id: releaseTarget.environmentId,
  target,
  tier: "production",
  jobs,
  release: {
    id: "rollout-v2",
    target: "git",
    releaseTarget,
    tag: "v2.0.0",
    planned: true,
    ended: true,
    endedAt: AT,
    landed: false,
    leftOut: [],
  },
});

// witness: packages/client-runtime/src/zerops/gitDelivery.ts | (job) => matches(job, repo, sha, accepted?.tag) && job.state !== "superseded", → (job) => matches(job, repo, sha) && job.state !== "superseded",
it("ZV+6: A Git release reads pushed only once every repository it takes has confirmed its commit; another release's receipt never completes it", () => {
  const both = gitDeliveryOf(environment([pushed("api", "v2.0.0"), pushed("web", "v2.0.0")]), {
    releases: [release],
  });
  expect([both?.standing, both?.pushed, both?.total]).toEqual(["pushed", 2, 2]);

  const borrowed = gitDeliveryOf(environment([pushed("api", "v2.0.0"), pushed("web", "v1.0.0")]), {
    releases: [release],
  });
  expect([borrowed?.standing, borrowed?.pushed, borrowed?.total]).toEqual(["checking", 1, 2]);
});
