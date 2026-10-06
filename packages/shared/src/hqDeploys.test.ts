import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { HqDeployAnswer, NO_DEPLOYS, WithDeploys, zeropsDidNotAnswer } from "./hqDeploys.ts";

describe("zeropsDidNotAnswer — HQ's words for a deploy Zerops did not answer", () => {
  it("says it, with what Zerops failed at", () => {
    expect(zeropsDidNotAnswer("connect ETIMEDOUT")).toBe(
      "Zerops did not answer: connect ETIMEDOUT",
    );
  });
});

describe("HqDeployAnswer — where each job an event asked for stands once HQ submitted it", () => {
  const decode = Schema.decodeUnknownSync(HqDeployAnswer);
  const outcome = {
    environment: "shop-stage",
    kind: "deploy",
    service: "web",
    sha: "a".repeat(40),
    job: "7",
    state: "building",
    processId: "process-1",
    behind: null,
    reason: null,
  };

  it.each([
    { name: "building", deploys: [outcome] },
    {
      name: "the evidence, version and steps of a pending operation",
      deploys: [
        {
          ...outcome,
          state: "submitting",
          appVersionId: "v1",
          verifiedVersionId: null,
          evidence: {
            phase: "waiting-for-build",
            nextActor: "person",
            nextAction: "Inspect v1 in Zerops; Run again if no build started",
            version: { id: "v1", status: "UPLOADING" },
            processes: [],
          },
          steps: [{ version: { id: "v1", status: "UPLOADING" }, processes: [] }],
        },
      ],
    },
    {
      name: "unresolved with the next actor",
      deploys: [
        {
          ...outcome,
          state: "unresolved",
          reason: "A person must inspect the original process in Zerops",
        },
      ],
    },
    {
      name: "queued behind the job its environment builds",
      deploys: [{ ...outcome, state: "queued", processId: null, behind: "6" }],
    },
    {
      name: "a service HQ asked nothing for",
      deploys: [
        {
          ...outcome,
          job: null,
          state: "skipped",
          processId: null,
          reason: "web already runs aaaaaaa",
        },
      ],
    },
    { name: "none", deploys: [] },
  ])("reads $name", ({ deploys }) => {
    expect(decode({ jobs: deploys, note: null })).toEqual({ jobs: deploys, note: null });
  });

  it("refuses a state no job is in", () => {
    expect(() => decode({ jobs: [{ ...outcome, state: "retrying" }], note: null })).toThrow();
  });

  it("answers nothing for an event that asked for no deploy", () => {
    expect(decode(NO_DEPLOYS)).toEqual({ jobs: [], note: null });
  });
});

const decodeWithDeploys = Schema.decodeUnknownSync(WithDeploys);

describe("WithDeploys — the deploys an event's own answer carries", () => {
  it("reads them beside what else the answer says", () => {
    expect(decodeWithDeploys({ number: 3, deploys: { jobs: [], note: "x" } })).toEqual({
      deploys: { jobs: [], note: "x" },
    });
  });
});
