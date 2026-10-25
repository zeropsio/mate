import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { describe, expect, it } from "vite-plus/test";

import {
  followHandedOver,
  WAITING_FOR_PLANNING,
  type DeployRollout,
} from "./deployHandover.logic.ts";
import type { HqJob } from "./environments.ts";

const MERGED = "5c3ea18b00000000000000000000000000000000";
const OTHER = "b21d904c00000000000000000000000000000000";
const MERGE: DeployRollout = { cause: "merge", ref: MERGED };
const HANDED_OVER: HqDeployAnswer = {
  jobs: [],
  note: "HQ plans these deploys once the organisation's other rollout is planned",
  planned: false,
};
const PLANNED_EMPTY: HqDeployAnswer = { jobs: [], note: "the stage tier could not be read" };

const job = (over: Partial<HqJob>): HqJob => ({
  id: "7",
  kind: "deploy",
  service: "web",
  sha: MERGED,
  state: "building",
  cause: "merge",
  ref: MERGED,
  reason: null,
  appVersionId: "version-7",
  processId: "process-7",
  requestedBy: null,
  at: "2026-10-25T10:00:00.000Z",
  endedAt: null,
  supersededBy: null,
  ...over,
});

const outcomeOf = (environment: string, from: HqJob) => ({
  environment,
  kind: from.kind,
  service: from.service,
  sha: from.sha,
  job: from.id,
  state: from.state,
  processId: from.processId,
  behind: null,
  reason: from.reason,
  appVersionId: from.appVersionId,
});

describe("a review whose answer handed planning over", () => {
  it.each<{
    readonly name: string;
    readonly answer: HqDeployAnswer;
    readonly rollout: DeployRollout | undefined;
    readonly environments: ReadonlyArray<{
      readonly name: string;
      readonly jobs: ReadonlyArray<HqJob>;
    }>;
    readonly said: HqDeployAnswer;
  }>([
    {
      name: "an answer from an HQ that does not say planned reads as planned and stays as answered",
      answer: PLANNED_EMPTY,
      rollout: MERGE,
      environments: [{ name: "stage", jobs: [job({})] }],
      said: PLANNED_EMPTY,
    },
    {
      name: "a planned answer with no jobs keeps HQ's reason, never a wait",
      answer: { ...PLANNED_EMPTY, planned: true },
      rollout: MERGE,
      environments: [{ name: "stage", jobs: [job({})] }],
      said: { ...PLANNED_EMPTY, planned: true },
    },
    {
      name: "a handed-over merge says it waits for planning while navigation shows none of its jobs",
      answer: HANDED_OVER,
      rollout: MERGE,
      environments: [
        {
          name: "stage",
          jobs: [
            job({ id: "6", sha: OTHER, ref: OTHER }),
            job({ id: "5", cause: "release", ref: MERGED }),
          ],
        },
      ],
      said: { jobs: [], note: WAITING_FOR_PLANNING, planned: false },
    },
    {
      name: "a handed-over answer whose event is not known still waits, never says nothing deploys",
      answer: HANDED_OVER,
      rollout: undefined,
      environments: [{ name: "stage", jobs: [job({})] }],
      said: { jobs: [], note: WAITING_FOR_PLANNING, planned: false },
    },
    {
      name: "a handed-over merge follows its rollout's jobs once navigation shows them, oldest first",
      answer: HANDED_OVER,
      rollout: MERGE,
      environments: [
        {
          name: "stage",
          jobs: [
            job({ id: "9", service: "api", state: "queued", processId: null, appVersionId: null }),
            job({ id: "8", sha: OTHER, ref: OTHER }),
            job({ id: "7" }),
          ],
        },
        { name: "stage-eu", jobs: [job({ id: "10", kind: "delta", service: null, sha: null })] },
      ],
      said: {
        jobs: [
          outcomeOf("stage", job({ id: "7" })),
          outcomeOf(
            "stage",
            job({ id: "9", service: "api", state: "queued", processId: null, appVersionId: null }),
          ),
          outcomeOf("stage-eu", job({ id: "10", kind: "delta", service: null, sha: null })),
        ],
        note: null,
      },
    },
    {
      name: "a handed-over release follows the jobs of its tag",
      answer: HANDED_OVER,
      rollout: { cause: "release", ref: "v1.2.0" },
      environments: [
        {
          name: "production",
          jobs: [
            job({ id: "12", cause: "release", ref: "v1.2.0", state: "live", processId: null }),
            job({ id: "11", cause: "release", ref: "v1.1.0", state: "live" }),
          ],
        },
      ],
      said: {
        jobs: [
          outcomeOf(
            "production",
            job({ id: "12", cause: "release", ref: "v1.2.0", state: "live", processId: null }),
          ),
        ],
        note: null,
      },
    },
  ])("$name", ({ answer, rollout, environments, said }) => {
    expect(followHandedOver(answer, rollout, environments)).toEqual(said);
  });
});
