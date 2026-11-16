import { describe, expect, it } from "vite-plus/test";

import {
  canonicalEnvironmentsOf,
  deliveryEnvironmentsOf,
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

describe("delivery environments", () => {
  it("reads Git push jobs by environment identity without inventing a project", () => {
    const git = {
      ...STAGE,
      can: {},
      id: "git-stage",
      target: { kind: "git", branch: "main", delivery: "direct" },
      jobs: [],
    };
    expect(deliveryEnvironmentsOf([git])?.[0]).toMatchObject({
      id: "git-stage",
      target: { kind: "git" },
      jobs: [],
    });
  });
});

it.each([undefined, null, 0, 1_305_166_613])(
  "environment reads preserve each job's source archive measurement: %j",
  (sourceArchiveBytes) => {
    const measured = {
      ...job("1", "app", "failed"),
      ...(sourceArchiveBytes === undefined ? {} : { sourceArchiveBytes }),
    };
    const stage = { ...STAGE, id: "p-stage", target: { kind: "zerops", projectId: "p-stage" } };
    expect(canonicalEnvironmentsOf([{ ...stage, jobs: [measured] }])?.[0]?.jobs).toEqual([
      measured,
    ]);
  },
);
