import * as Deploys from "./hqDeploys.ts";
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

  it.each([undefined, null, 0, 1_305_166_613])(
    "a deployment answer preserves only its job's measured source archive bytes: %j",
    (sourceArchiveBytes) => {
      const job = {
        ...outcome,
        ...(sourceArchiveBytes === undefined ? {} : { sourceArchiveBytes }),
      };
      expect(decode({ jobs: [job], note: null }).jobs).toEqual([job]);
    },
  );

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

it("A push receipt keeps its attempted destination and fixed sha distinct from a later remote observation.", () => {
  expect(Deploys).toHaveProperty("HqPushEvidence");
  const attempt = {
    remote: { url: "https://github.com/acme/app.git", repositoryId: "42" },
    ref: "refs/heads/production",
    sha: "a".repeat(40),
    credentialKeptAt: "2026-10-13T10:00:00.000Z",
    before: "b".repeat(40),
    phase: "recovering",
  };
  const value = {
    attempt,
    observed: "c".repeat(40),
    nextActor: "person",
    nextAction: "Inspect branch",
  };
  expect(Schema.decodeUnknownSync(Deploys.HqPushEvidence)(value)).toEqual(value);
  for (const patch of [
    { sha: "short" },
    { ref: "refs/tags/v1.0.0" },
    { before: "short" },
    { credentialKeptAt: "bad" },
    { phase: "building" },
  ]) {
    expect(
      Schema.decodeUnknownExit(Deploys.HqPushEvidence)({
        ...value,
        attempt: { ...attempt, ...patch },
      })._tag,
    ).toBe("Failure");
  }
  const decoded = Schema.decodeUnknownSync(Deploys.HqPushEvidence)({
    ...value,
    token: "TOKEN_MARKER",
    attempt: { ...attempt, token: "TOKEN_MARKER" },
  });
  expect(JSON.stringify(Schema.encodeSync(Deploys.HqPushEvidence)(decoded))).not.toContain(
    "TOKEN_MARKER",
  );
});

it.each(["building", "live", "failed", "skipped"])(
  "Push outcomes cannot claim the Zerops state %s.",
  (state) => {
    expect(Deploys).toHaveProperty("HqPushOutcome");
    const value = {
      environment: "Production",
      kind: "push",
      service: "App_Code-2",
      sha: "a".repeat(40),
      job: "9",
      state,
      processId: null,
      behind: null,
      reason: null,
    };
    expect(Schema.decodeUnknownExit(Deploys.HqPushOutcome)(value)._tag).toBe("Failure");
  },
);

it("A confirmed push requires the same remote, ref, before and fixed outgoing sha as its attempt.", () => {
  const remote = { url: "https://github.com/acme/app.git", repositoryId: "42" };
  const attempt = {
    remote,
    ref: "refs/heads/production",
    sha: "a".repeat(40),
    credentialKeptAt: "2026-10-13T10:00:00.000Z",
    before: "b".repeat(40),
    phase: "submitting",
  };
  const confirmed = {
    remote,
    ref: attempt.ref,
    before: attempt.before,
    after: attempt.sha,
    at: attempt.credentialKeptAt,
    via: "answer",
  };
  const value = { attempt, confirmed, nextActor: "none", nextAction: "Open repository" };
  expect(Schema.decodeUnknownSync(Deploys.HqPushEvidence)(value)).toEqual(value);
  for (const patch of [
    { remote: { ...remote, repositoryId: "43" } },
    { remote: { ...remote, url: "https://github.com/acme/other.git" } },
    { ref: "refs/heads/staging" },
    { before: null },
    { after: "c".repeat(40) },
    { via: "invented" },
  ]) {
    expect(
      Schema.decodeUnknownExit(Deploys.HqPushEvidence)({
        ...value,
        confirmed: { ...confirmed, ...patch },
      })._tag,
    ).toBe("Failure");
  }
  const outcome = {
    environment: "Production",
    kind: "push",
    service: "App_Code-2",
    sha: attempt.sha,
    job: "9",
    state: "pushed",
    processId: null,
    behind: null,
    reason: null,
    evidence: value,
    steps: [value],
  };
  expect(
    Schema.decodeUnknownSync(Deploys.HqDeliveryAnswer)({ jobs: [outcome], note: null }),
  ).toEqual({ jobs: [outcome], note: null });
  for (const patch of [
    { evidence: undefined },
    { evidence: { ...value, confirmed: undefined } },
    { sha: "c".repeat(40) },
    { processId: "zerops-process" },
    { appVersionId: "zerops-version" },
  ]) {
    expect(Schema.decodeUnknownExit(Deploys.HqPushOutcome)({ ...outcome, ...patch })._tag).toBe(
      "Failure",
    );
  }
  const decoded = Schema.decodeUnknownSync(Deploys.HqPushOutcome)({
    ...outcome,
    steps: [{ ...value, token: "TOKEN_MARKER", attempt: { ...attempt, token: "TOKEN_MARKER" } }],
  });
  expect(JSON.stringify(Schema.encodeSync(Deploys.HqPushOutcome)(decoded))).not.toContain(
    "TOKEN_MARKER",
  );
});

it("A push's CI record belongs to the commit the hand-over confirmed.", () => {
  const remote = { url: "https://github.com/acme/app.git", repositoryId: "42" };
  const attempt = {
    remote,
    ref: "refs/heads/main",
    sha: "a".repeat(40),
    credentialKeptAt: "2026-10-13T10:00:00.000Z",
    before: null,
    phase: "submitting",
  };
  const confirmed = {
    remote,
    ref: attempt.ref,
    before: null,
    after: attempt.sha,
    at: "2026-10-13T10:00:05.000Z",
    via: "answer",
  };
  const ci = {
    sha: attempt.sha,
    verdict: "failed",
    done: 3,
    total: 4,
    failed: [{ name: "check_types", url: "https://github.com/acme/app/actions/runs/1/job/2" }],
    required: null,
    reason: null,
    watch: "watching",
    readAt: "2026-10-13T10:01:00.000Z",
    until: "2026-10-13T11:00:05.000Z",
  };
  const value = { attempt, confirmed, ci, nextActor: "none", nextAction: "Operation ended" };
  expect(Schema.decodeUnknownSync(Deploys.HqPushEvidence)(value)).toEqual(value);
  for (const evidence of [
    { ...value, ci: { ...ci, sha: "c".repeat(40) } },
    { attempt, ci, nextActor: "hq", nextAction: "Read the remote ref" },
    { ...value, ci: { ...ci, verdict: "green" } },
    { ...value, ci: { ...ci, watch: "forever" } },
  ])
    expect(Schema.decodeUnknownExit(Deploys.HqPushEvidence)(evidence)._tag).toBe("Failure");
});
