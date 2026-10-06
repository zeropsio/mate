import { describe, expect, it } from "vite-plus/test";

import {
  environmentsOf,
  jobFailed,
  jobInFlight,
  jobsByService,
  type HqEnvironment,
  type HqJob,
} from "./environments.ts";

const A = "a".repeat(40);

const job = (id: string, service: string | null, state: HqJob["state"]): HqJob => ({
  id,
  kind: service === null ? "delta" : "deploy",
  service,
  sha: service === null ? null : A,
  state,
  cause: "merge",
  ref: A,
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at: "2026-10-03T10:00:00.000Z",
  endedAt: jobInFlight({ state }) ? null : "2026-10-03T10:04:00.000Z",
  supersededBy: null,
});

const STAGE: HqEnvironment = {
  projectId: "p-stage",
  tier: "stage",
  name: "stage",
  sources: ["main"],
  order: 1,
  keyHeld: true,
  keyInvalid: false,
  jobs: [],
  release: null,
  birth: null,
};

describe("jobsByService — each service's newest job and newest live one, from HQ's newest first", () => {
  it.each<{
    readonly name: string;
    readonly jobs: ReadonlyArray<HqJob>;
    readonly expected: ReadonlyArray<[string, string, string | null]>;
  }>([
    { name: "no job", jobs: [], expected: [] },
    {
      name: "a job building over the live one",
      jobs: [job("3", "app", "building"), job("2", "app", "live"), job("1", "app", "live")],
      expected: [["app", "3", "2"]],
    },
    {
      name: "a newest job that went live is both",
      jobs: [job("2", "app", "live"), job("1", "app", "failed")],
      expected: [["app", "2", "2"]],
    },
    {
      name: "never live",
      jobs: [job("2", "app", "refused"), job("1", "app", "superseded")],
      expected: [["app", "2", null]],
    },
    {
      name: "each service apart",
      jobs: [job("3", "api", "queued"), job("2", "app", "live"), job("1", "api", "live")],
      expected: [
        ["api", "3", "1"],
        ["app", "2", "2"],
      ],
    },
    {
      name: "a delta deploys no service",
      jobs: [job("2", null, "live"), job("1", "app", "failed")],
      expected: [["app", "1", null]],
    },
  ])("$name", ({ jobs, expected }) => {
    const services = jobsByService({ jobs });
    expect(
      [...services].map(([service, { latest, live }]) => [service, latest.id, live?.id ?? null]),
    ).toEqual(expected);
  });
});

describe("a job's state", () => {
  it.each([
    { state: "queued", inFlight: true, failed: false },
    { state: "submitting", inFlight: true, failed: false },
    { state: "building", inFlight: true, failed: false },
    { state: "live", inFlight: false, failed: false },
    { state: "failed", inFlight: false, failed: true },
    { state: "refused", inFlight: false, failed: true },
    { state: "unresolved", inFlight: false, failed: false },
    { state: "superseded", inFlight: false, failed: false },
  ] as const)("$state: in flight $inFlight, failed $failed", ({ state, inFlight, failed }) => {
    expect([jobInFlight({ state }), jobFailed({ state })]).toEqual([inFlight, failed]);
  });
});

describe("environmentsOf", () => {
  it("keeps operation evidence and steps through the environment decode", () => {
    const environment = {
      ...STAGE,
      jobs: [
        {
          ...job("1", "app", "unresolved"),
          evidence: {
            phase: "closed",
            nextActor: "person",
            nextAction: "Inspect the original version in Zerops",
            processes: [{ id: "p1", status: "FINISHED" }],
            version: { id: "v1", status: "BUILDING" },
          },
          steps: [{ processes: [{ id: "p1", status: "RUNNING" }] }],
          verifiedVersionId: null,
        },
      ],
    };
    expect(environmentsOf([environment])).toEqual([environment]);
  });

  it("reads an environment with its jobs", () => {
    const environment = { ...STAGE, jobs: [job("1", "app", "live")] };
    expect(environmentsOf([environment])).toEqual([environment]);
  });

  it("retains every environment when one accepted operation is unresolved", () => {
    const stage = {
      ...STAGE,
      jobs: [
        {
          ...job("2", "app", "live"),
          state: "unresolved",
          reason: "A person must inspect the process in Zerops",
        },
        job("1", "app", "live"),
      ],
    };
    const production = { ...STAGE, projectId: "p-prod", tier: "production" };
    expect(environmentsOf([stage, production])).toEqual([stage, production]);
  });

  it("reads a production with where its newest release stands", () => {
    const production: HqEnvironment = {
      ...STAGE,
      projectId: "p-prod",
      tier: "production",
      sources: ["release"],
      release: {
        id: "7",
        tag: "v0.1.3",
        planned: true,
        ended: false,
        endedAt: null,
        landed: false,
        leftOut: [{ service: "api", sha: A, job: "5", reason: "a job of aaaaaaa is under way" }],
      },
    };
    expect(environmentsOf([production])).toEqual([production]);
  });

  // Review (client #4): a Core older than this client tells neither where a release stands nor
  // whether it is bringing an environment up. Its environments are still read — what it does not
  // say is not known, never on its way and never coming up.
  it("reads an environment from a Core that tells no release and no birth", () => {
    const { release: _release, birth: _birth, ...older } = STAGE;
    expect(environmentsOf([older])).toEqual([older]);
  });

  // Review (delta #9): a Core from before `landed` names a release's end without saying whether it
  // landed: its environments are still read, and nothing is said to have landed.
  it("reads a production's release from a Core that tells no landing", () => {
    const { landed: _landed, ...release } = {
      id: "7",
      tag: "v0.1.3",
      planned: true,
      ended: true,
      endedAt: "2026-10-03T10:00:00.000Z",
      landed: false,
      leftOut: [],
    };
    const production = { ...STAGE, projectId: "p-prod", tier: "production" as const, release };
    expect(environmentsOf([production])?.[0]?.release).toEqual(release);
  });

  // HQ and the client ship together: a set in the shape before jobs is one this build cannot read.
  it("does not read an environment HQ sent with deploys and no jobs", () => {
    const { jobs: _, ...before } = STAGE;
    expect(
      environmentsOf([{ ...before, deploys: [{ service: "app", latest: null, live: null }] }]),
    ).toBeUndefined();
  });

  it("does not read a job in a state this build does not know", () => {
    expect(
      environmentsOf([{ ...STAGE, jobs: [{ ...job("1", "app", "live"), state: "deploying" }] }]),
    ).toBeUndefined();
  });
});
