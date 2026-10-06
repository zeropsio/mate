import type { HqDeployOutcome } from "@t3tools/shared/hqDeploys";
import { describe, expect, it } from "vite-plus/test";

import {
  deployAnswerFollowing,
  deployAnswerSaid,
  type ObservedDeployOutcome,
} from "./deployAnswer.ts";

const WEB = "5c3ea18b00000000000000000000000000000000";
const API = "b21d904c00000000000000000000000000000000";

const outcome = (over: Partial<HqDeployOutcome>): HqDeployOutcome => ({
  environment: "stage",
  kind: "deploy",
  service: "web",
  sha: WEB,
  job: "1",
  state: "building",
  processId: "process-1",
  behind: null,
  reason: null,
  ...over,
});

describe("deployAnswerSaid — what an event's answer says of its deploys", () => {
  it.each<{ readonly name: string; readonly job: ObservedDeployOutcome; readonly text: string }>([
    { name: "building", job: outcome({}), text: "web 5c3ea18 building" },
    {
      name: "unresolved, with the next actor and action from its evidence",
      job: {
        ...outcome({ state: "unresolved", reason: "Observation was interrupted" }),
        evidence: {
          nextActor: "person",
          nextAction: "Inspect the original version in Zerops before asking Run again",
        },
      },
      text: "web 5c3ea18: HQ could not follow this deploy to its end. A person acts next: Inspect the original version in Zerops before asking Run again",
    },
    {
      name: "unresolved, with HQ still assigned the named next action",
      job: {
        ...outcome({ state: "unresolved" }),
        evidence: {
          nextActor: "hq",
          nextAction: "Read the original process handle after authorization is restored",
        },
      },
      text: "web 5c3ea18: HQ could not follow this deploy to its end. HQ acts next: Read the original process handle after authorization is restored",
    },
    {
      name: "unresolved from the job answer before operation evidence arrives",
      job: outcome({
        state: "unresolved",
        reason: "A person must inspect the original version in Zerops",
      }),
      text: "web 5c3ea18: HQ could not follow this deploy to its end. A person must inspect the original version in Zerops",
    },
    {
      name: "its submission's answer lost",
      job: outcome({ state: "submitting", processId: null }),
      text: "web 5c3ea18 submitted; HQ reads where it stands",
    },
    {
      name: "queued behind a build the answer does not name",
      job: outcome({ state: "queued", processId: null, behind: "9" }),
      text: "web 5c3ea18 queued behind the build under way",
    },
    {
      name: "live at once, running it already",
      job: outcome({ state: "live", processId: null, reason: "web already runs it" }),
      text: "web 5c3ea18: web already runs it",
    },
    {
      name: "refused at its one try",
      job: outcome({ state: "refused", processId: null, reason: "Zerops did not answer: timeout" }),
      text: "HQ refused web 5c3ea18: Zerops did not answer: timeout",
    },
    {
      name: "skipped, and why",
      job: outcome({
        state: "skipped",
        processId: null,
        reason: "web has no zerops.yaml at 5c3ea18",
      }),
      text: "web 5c3ea18 skipped: web has no zerops.yaml at 5c3ea18",
    },
    {
      name: "a service asked nothing for",
      job: outcome({
        job: null,
        state: "skipped",
        processId: null,
        reason: "web already runs 5c3ea18",
      }),
      text: "web 5c3ea18 skipped: web already runs 5c3ea18",
    },
    {
      name: "failed with no words",
      job: outcome({ state: "failed", processId: null }),
      text: "web 5c3ea18 failed",
    },
    {
      name: "a delta, its import under way",
      job: outcome({ kind: "delta", service: null, sha: null, state: "building", processId: null }),
      text: "The recipe's services being added",
    },
    {
      name: "a delta, its services added",
      job: outcome({
        kind: "delta",
        service: null,
        sha: null,
        state: "live",
        processId: null,
        reason: "added cache",
      }),
      text: "The recipe's services: added cache",
    },
  ])("says $name", ({ job, text }) => {
    expect(deployAnswerSaid({ jobs: [job], note: null }).environments).toMatchObject([
      { environment: "stage", jobs: [{ state: job.state, text }] },
    ]);
  });

  it("names what a job waits behind where the answer holds it, and keeps each environment apart", () => {
    const said = deployAnswerSaid({
      jobs: [
        outcome({ service: "api", sha: API, job: "4" }),
        outcome({ job: "5", state: "queued", processId: null, behind: "4" }),
        outcome({ environment: "production", job: "6", state: "skipped", reason: "no release" }),
      ],
      note: "  the stage tier was refused: invalid ",
    });
    expect(said).toMatchObject({
      environments: [
        {
          environment: "stage",
          jobs: [
            { state: "building", text: "api b21d904 building" },
            { state: "queued", text: "web 5c3ea18 queued behind api b21d904" },
          ],
        },
        {
          environment: "production",
          jobs: [{ state: "skipped", text: "web 5c3ea18 skipped: no release" }],
        },
      ],
      note: "the stage tier was refused: invalid",
    });
  });

  it("gives the same outcome without the service name for its existing row", () => {
    const [environment] = deployAnswerSaid({
      jobs: [outcome({ state: "queued", behind: "9" })],
      note: null,
    }).environments;
    expect(environment?.jobs[0]).toMatchObject({
      service: "web",
      line: "5c3ea18 queued behind the build under way",
    });
  });

  it.each([
    ["refused", "no deploy key", "HQ refused: no deploy key"],
    ["skipped", "no recipe", "skipped: no recipe"],
    ["live", "already runs it", "already runs it"],
  ] as const)("says a %s answer without a commit, on its service's row", (state, reason, line) => {
    const [environment] = deployAnswerSaid({
      jobs: [outcome({ state, reason, sha: null })],
      note: null,
    }).environments;
    expect(environment?.jobs[0]?.line).toBe(line);
  });

  it("says nothing of an event that asked for nothing", () => {
    expect(deployAnswerSaid({ jobs: [], note: null })).toEqual({
      environments: [],
      note: undefined,
    });
  });
});

it("retains the deploy answer's job and process for inspection", () => {
  const said = deployAnswerSaid({ jobs: [outcome({ job: "7", processId: "p7" })], note: null });
  expect(said.environments[0]?.jobs[0]).toMatchObject({
    jobId: "7",
    deployLog: { jobId: "7", processId: "p7", appVersionId: null },
  });
});

it("retains unresolved operation evidence, known versions and steps beside the inspection handle", () => {
  const job = {
    ...outcome({ state: "unresolved" }),
    appVersionId: "v7",
    verifiedVersionId: "v6",
    evidence: { nextActor: "person" as const, nextAction: "Inspect v7 in Zerops" },
    steps: [
      {
        processes: [{ id: "process-1", status: "FINISHED" }],
        version: { id: "v7", status: "BUILDING" },
      },
    ],
  };
  const said = deployAnswerSaid({ jobs: [job], note: null }).environments[0]!.jobs[0]!;
  expect(said).toMatchObject({
    state: "unresolved",
    appVersionId: "v7",
    verifiedVersionId: "v6",
    evidence: job.evidence,
    steps: job.steps,
    deployLog: { jobId: "1", processId: "process-1", appVersionId: "v7" },
  });
});

describe("deployAnswerFollowing — HQ's stream over the request's snapshot", () => {
  it.each(["supplied", "missing"] as const)(
    "keeps known facts while following unresolved evidence that is %s",
    (coverage) => {
      const prior = {
        ...outcome({}),
        appVersionId: "v6",
        verifiedVersionId: "v5",
        evidence: { nextActor: "hq" as const, nextAction: "Read the original process" },
        steps: [{ processes: [{ id: "process-1", status: "RUNNING" }] }],
      };
      const observed = {
        state: "unresolved" as const,
        reason: "HQ could no longer observe this operation",
        processId: null,
        ...(coverage === "missing"
          ? { evidence: null, appVersionId: null, verifiedVersionId: null }
          : {
              appVersionId: "v7",
              verifiedVersionId: "v6",
              evidence: {
                nextActor: "person" as const,
                nextAction: "Inspect v7 in Zerops before asking Run again",
              },
              steps: [...prior.steps, { processes: [{ id: "process-1", status: "FINISHED" }] }],
            }),
      };
      const followed = deployAnswerFollowing(
        { jobs: [prior], note: null },
        new Map([["1", observed]]),
      );
      expect(followed.jobs[0]).toMatchObject({
        state: "unresolved",
        processId: "process-1",
        appVersionId: observed.appVersionId ?? prior.appVersionId,
        verifiedVersionId: observed.verifiedVersionId ?? prior.verifiedVersionId,
        evidence: observed.evidence ?? prior.evidence,
        steps: "steps" in observed ? observed.steps : prior.steps,
      });
      expect(deployAnswerSaid(followed).environments[0]?.jobs[0]?.text).toContain(
        (observed.evidence ?? prior.evidence).nextAction,
      );
    },
  );

  it("takes the streamed state of a job it finds by id, and keeps the rest as answered", () => {
    const answer = {
      jobs: [
        outcome({ job: "1" }),
        outcome({ job: "2", service: "api", sha: API }),
        outcome({ job: null }),
      ],
      note: null,
    };
    const followed = deployAnswerFollowing(
      answer,
      new Map([["1", { state: "failed" as const, reason: "build broke", processId: null }]]),
    );
    expect(followed.jobs[0]).toMatchObject({
      state: "failed",
      reason: "build broke",
      processId: "process-1",
    });
    expect(followed.jobs.slice(1)).toEqual(answer.jobs.slice(1));
  });
});
