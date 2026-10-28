import * as Stream from "./hqStream.ts";
import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  hqStreamCloseFailure,
  HqZeropsRefusedResponse,
  HQ_ZEROPS_REFUSED,
  HqStreamRequest,
  HqStreamMessage,
  HqNavigationStatus,
  HqNavigationApp,
  CanonicalHqNavigationApp,
  CanonicalHqNavigationEnvironment,
  HqNavigationEnvironment,
  HqNavigationMate,
  HqNavigationPress,
  HqPersonFacts,
  HqNavigationPerson,
  HqNavigationProject,
  HqHandoverCandidatesMessage,
  HqHandoverCandidatesError,
} from "./hqStream.ts";

it.each([
  { close: 4403, failure: { code: "zerops_refused", disposition: "refused" } },
  { close: 1011, failure: { code: "socket_1011", disposition: "transient" } },
  { close: 4410, failure: { code: "socket_4410", disposition: "transient" } },
  { close: 4401, failure: { code: "session_ended", disposition: "session-ended" } },
])("the client classifies HQ close $close", ({ close, failure }) => {
  expect(hqStreamCloseFailure(close)).toEqual(failure);
});

const read = Schema.decodeUnknownSync(HqZeropsRefusedResponse);
const readRequest = Schema.decodeUnknownSync(HqStreamRequest);
const readApp = Schema.decodeUnknownSync(HqNavigationApp);
const readMate = Schema.decodeSync(HqNavigationMate);
const readPress = Schema.decodeUnknownSync(HqNavigationPress);
const readStatus = Schema.decodeUnknownSync(HqNavigationStatus);
const readWire = Schema.decodeUnknownSync(Schema.fromJsonString(HqStreamMessage));

it.each([{ type: "retry" }, { type: "retry", scopes: [{ kind: "navigation" }] }])(
  "decodes a person's explicit retry: %j",
  (request) => {
    expect(readRequest(request)).toEqual(request);
  },
);

it("status is a separate small navigation fact", () => {
  expect(readStatus({ parts: { db: "up" } })).toEqual({
    parts: { db: "up" },
  });
});

it("defines the definitive HTTP refusal separately from an unavailable response", () => {
  expect(HQ_ZEROPS_REFUSED.status).toBe(403);
  expect(read({ code: HQ_ZEROPS_REFUSED.code, reason: "forbidden" })).toEqual({
    code: "zerops_refused",
    reason: "forbidden",
  });
  expect(read({ code: "zerops_refused" })).toEqual({ code: "zerops_refused" });
  expect(() => read({ code: "zerops_unavailable" })).toThrow();
});

it("navigation preserves production release standing and deploy evidence", () => {
  const value = {
    id: "app",
    name: "Shop",
    can: { read_change: { allow: true } },
    contents: { empty: false, deletingProjectIds: [] },
    projectIds: ["production"],
    births: [],
    releaseOffer: null,
    changes: [
      {
        repo: "appdev",
        number: 1,
        mateProjectId: "mate",
        title: "Add a login page",
        state: "open",
        hasHead: true,
        updatedAt: "2026-10-06T00:00:00Z",
        mergeability: "conflict",
        ready: false,
      },
    ],
    environments: [
      {
        projectId: "production",
        tier: "production",
        name: "prod",
        sources: ["release"],
        order: 1,
        keyHeld: true,
        keyInvalid: false,
        can: { keep_deploy_token: { allow: true } },
        jobs: [
          {
            id: "job",
            kind: "deploy",
            service: "web",
            sha: "sha",
            state: "unresolved",
            cause: "release",
            ref: "v1.0.0",
            reason: "version displaced",
            appVersionId: "version",
            processId: "process",
            evidence: {
              phase: "closed",
              nextActor: "person",
              nextAction: "Inspect version",
              processes: [{ id: "process", status: "FINISHED" }],
            },
            steps: [{ phase: "finished" }],
            verifiedVersionId: null,
            requestedBy: "owner",
            at: "2026-10-06T00:00:00Z",
            endedAt: "2026-10-06T00:01:00Z",
            supersededBy: null,
          },
        ],
        release: {
          id: "rollout",
          tag: "v1.0.0",
          planned: true,
          ended: true,
          endedAt: "2026-10-06T00:01:00Z",
          landed: false,
          leftOut: [],
        },
        birth: { ended: true },
      },
    ],
  };
  expect(readApp(value)).toEqual(value);
  expect(Schema.decodeUnknownSync(CanonicalHqNavigationApp)(value)).toEqual({
    ...value,
    environments: value.environments.map((environment) => ({
      ...environment,
      id: environment.projectId,
      target: { kind: "zerops", projectId: environment.projectId },
    })),
  });
  expect(
    readApp({
      ...value,
      environments: { refused: "changes_not_seen" },
    }).environments,
  ).toEqual({ refused: "changes_not_seen" });
  const press = {
    kind: "production",
    appId: "app",
    heldForMs: 9000,
    until: "2026-10-06T00:01:00Z",
    importProcessId: "import",
  };
  expect(readPress(press)).toEqual(press);
});

it.each([true, false, null])("navigation carries setup marker evidence %s", (setupMarker) => {
  const value = {
    face: "",
    madeBy: null,
    standupRequestedBy: null,
    closedOff: false,
    setupMarker,
    keyWider: false,
  };
  expect(readMate(value)).toEqual(value);
});

it.each(["forbidden", "zerops_refused", "scope_not_found"])(
  "keeps scope-error code %s in the wire for worded refusals",
  (code) => {
    const failure = {
      type: "scope-error",
      scope: { kind: "navigation" },
      code,
      reason: "no-access",
      disposition: "refused",
    };
    expect(readWire(JSON.stringify(failure))).toEqual(failure);
  },
);

const readFacts = Schema.decodeUnknownSync(HqPersonFacts);
const readPerson = Schema.decodeUnknownSync(HqNavigationPerson);
const readCandidates = Schema.decodeUnknownSync(HqHandoverCandidatesMessage);
const readCandidatesError = Schema.decodeUnknownSync(HqHandoverCandidatesError);
it("defines person ownership separately from who the Mate waits on, and correlated candidates", () => {
  const facts = {
    role: "OWNER",
    mayWrite: true,
    mine: true,
    ownerUserId: "owner",
    waitsOnViewer: false,
    unseen: 0,
  };
  expect(readFacts(facts)).toEqual(facts);
  const person = { name: "Ada", clientUserId: "client-user", avatarUrl: null };
  expect(readPerson(person)).toEqual(person);
  const request = { type: "handover-candidates", requestId: "request", projectId: "project" };
  expect(readRequest(request)).toEqual(request);
  const reply = { ...request, candidates: [{ ...person, userId: "ada" }] };
  expect(readCandidates(reply)).toEqual(reply);
  for (const disposition of ["refused", "transient"]) {
    const failure = {
      ...request,
      type: "handover-candidates-error",
      code: "unavailable",
      reason: null,
      disposition,
    };
    expect(readCandidatesError(failure)).toEqual(failure);
  }
});

it.each(
  Array.from([undefined, "a".repeat(40)], (base) => ({
    title: `carries a correlated compare ${base === undefined ? "history" : "range"} read`,
    base,
  })),
)("$title", ({ base }) => {
  const request = {
    type: "compare",
    requestId: "r",
    appId: "app",
    repo: "appdev",
    ...(base === undefined ? {} : { base }),
    head: "b".repeat(40),
  };
  expect(readRequest(request)).toEqual(request);
  const reply = {
    type: "compare",
    requestId: "r",
    appId: "app",
    repo: "appdev",
    result: { base: base ?? null, head: request.head, commits: [], truncated: false, total: 0 },
  };
  expect(readWire(JSON.stringify(reply))).toEqual(reply);
  for (const disposition of ["refused", "transient"]) {
    const failure = {
      type: "compare-error",
      requestId: "r",
      appId: "app",
      repo: "appdev",
      code: "unavailable",
      reason: null,
      disposition,
    };
    expect(readWire(JSON.stringify(failure))).toEqual(failure);
  }
});
it.each([
  { head: "main" },
  { base: "--all", head: "a".repeat(40) },
  { base: "", head: "a".repeat(40) },
  {},
])("rejects malformed compare refs %j", (query) => {
  expect(() =>
    readRequest({ type: "compare", requestId: "r", appId: "app", repo: "appdev", ...query }),
  ).toThrow();
});

it("navigation distinguishes current and historical login people and carries finish decisions", () => {
  const read = Schema.decodeUnknownSync(HqNavigationProject);
  const value = {
    projectId: "P",
    appId: "A",
    name: "Stage",
    kind: "devstage",
    mate: null,
    can: { finish: { allow: false, reason: "not_structure_writer" } },
    person: {
      role: "OWNER",
      mayWrite: true,
      mine: true,
      ownerUserId: "owner",
      waitsOnViewer: false,
      unseen: null,
    },
    signedInNow: { "custom-agent": "reader" },
    everSignedIn: { "claude-code": "owner", "custom-agent": "reader" },
  };
  expect(read(value)).toEqual(value);
  const { signedInNow: _now, everSignedIn: _ever, ...old } = value;
  expect(() => read({ ...old, signers: { "claude-code": "owner" } })).toThrow();
});

it("An older navigation reader accepts a modern Zerops emission.", () => {
  // This required legacy DTO also witnesses unchanged typed callers.
  const legacy: HqNavigationEnvironment = {
    projectId: "production",
    tier: "production",
    name: "prod",
    sources: ["release"],
    order: 1,
    keyHeld: true,
    keyInvalid: false,
    can: { keep_deploy_token: { allow: true } },
    jobs: [],
    release: {
      id: "rollout",
      tag: "v1.0.0",
      planned: true,
      ended: true,
      endedAt: null,
      leftOut: [],
    },
    birth: { ended: true },
  };
  const modern = {
    ...legacy,
    id: "production",
    target: { kind: "zerops", projectId: "production" },
  };
  const wire = Schema.encodeUnknownSync(Schema.toCodecJson(CanonicalHqNavigationEnvironment))(
    modern,
  );
  expect(wire).toEqual(modern);
  // Kept pre-change decoder; its expectation is independent of canonical decoding.
  expect(Schema.decodeUnknownSync(HqNavigationEnvironment)(wire)).toEqual(legacy);
});

it("Canonical navigation round-trips identity and retains list refusals.", () => {
  const value = {
    id: "app",
    name: "Shop",
    can: {},
    contents: { empty: false, deletingProjectIds: [] },
    projectIds: ["production"],
    births: [],
    releaseOffer: null,
    changes: [],
    environments: [
      {
        id: "environment",
        target: { kind: "zerops", projectId: "production" },
        tier: "production",
        name: "prod",
        sources: ["release"],
        order: 1,
        keyHeld: true,
        keyInvalid: false,
        can: {},
        jobs: [],
        release: null,
        birth: null,
      },
    ],
  };
  const codec = Schema.toCodecJson(CanonicalHqNavigationApp);
  const wire = Schema.encodeUnknownSync(codec)(value);
  expect(wire).toEqual(value);
  expect(Schema.decodeUnknownSync(codec)(wire)).toEqual(value);
  expect(
    Schema.decodeUnknownSync(codec)({ ...value, environments: { refused: "forbidden" } }),
  ).toEqual({
    ...value,
    environments: { refused: "forbidden" },
  });
});

it("The navigation release offer retains a reviewed destination without deriving it from a project id.", () => {
  const value = {
    head: "a".repeat(40),
    suggestion: "v1.0.0",
    summary: { subjects: [], total: 0, more: 0, atLeast: false },
    gate: { allow: true },
    inFlight: null,
    releaseTarget: {
      environmentId: "git-id",
      createdAt: "2026-10-13T10:00:00.000Z",
      target: { kind: "git", branch: "production", delivery: "direct" },
    },
  };
  expect(Schema.decodeUnknownSync(Stream.HqNavigationReleaseOffer)(value)).toEqual(value);
});

it("Push navigation carries attempted and confirmed hand-over evidence without token values.", () => {
  expect(Stream).toHaveProperty("HqPushNavigationJob");
  const attempt = {
    remote: { url: "https://github.com/acme/app.git", repositoryId: "42" },
    ref: "refs/heads/production",
    sha: "a".repeat(40),
    credentialKeptAt: "2026-10-13T10:00:00.000Z",
    before: null,
    phase: "submitting",
  };
  const value = {
    id: "9",
    kind: "push",
    service: "App_Code-2",
    sha: attempt.sha,
    state: "pushed",
    cause: "release",
    ref: "v1.0.0",
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: "person",
    at: attempt.credentialKeptAt,
    endedAt: attempt.credentialKeptAt,
    supersededBy: null,
    evidence: {
      nextActor: "none",
      nextAction: "Open repository",
      attempt,
      confirmed: {
        remote: attempt.remote,
        ref: attempt.ref,
        before: null,
        after: attempt.sha,
        at: attempt.credentialKeptAt,
        via: "answer",
      },
    },
  };
  expect(Schema.decodeUnknownSync(Stream.HqPushNavigationJob)(value)).toEqual(value);
  const environment = {
    id: "git-id",
    projectId: "unrelated-project",
    target: { kind: "git", branch: "production", delivery: "direct" },
    tier: "production",
    name: "Production",
    sources: ["release"],
    order: 1,
    keyHeld: false,
    keyInvalid: false,
    can: {},
    jobs: [value],
    release: null,
    birth: null,
  };
  expect(Schema.decodeUnknownSync(Stream.HqGitNavigationEnvironment)(environment)).toEqual(
    environment,
  );

  const decoded = Schema.decodeUnknownSync(Stream.HqPushNavigationJob)({
    ...value,
    token: "TOKEN_MARKER",
    evidence: { ...value.evidence, token: "TOKEN_MARKER" },
  });
  expect(JSON.stringify(Schema.encodeSync(Stream.HqPushNavigationJob)(decoded))).not.toContain(
    "TOKEN_MARKER",
  );
});

it("A release offer preserves recorded change counts without requiring them from older HQs.", () => {
  const value = {
    head: "a".repeat(40),
    suggestion: "v1.0.0",
    gate: { allow: true },
    inFlight: null,
    summary: {
      subjects: ["#7 Search the catalogue"],
      changeCount: 1,
      total: 6,
      more: 0,
      atLeast: false,
    },
  };
  expect(Schema.decodeUnknownSync(Stream.HqNavigationReleaseOffer)(value)).toEqual(value);
  const { changeCount: _, ...legacySummary } = value.summary;
  expect(
    Schema.decodeUnknownSync(Stream.HqNavigationReleaseOffer)({ ...value, summary: legacySummary })
      .summary,
  ).toEqual(legacySummary);
});

it.each([undefined, null, 0, 1_305_166_613])(
  "navigation preserves the source archive measurement of its exact deployment job: %j",
  (sourceArchiveBytes) => {
    const job = {
      id: "job",
      kind: "deploy",
      service: "web",
      sha: "sha",
      state: "failed",
      cause: "release",
      ref: "v1.0.0",
      reason: "archive exceeds cap",
      appVersionId: null,
      processId: null,
      requestedBy: "owner",
      at: "2026-10-28T00:00:00Z",
      endedAt: "2026-10-28T00:01:00Z",
      supersededBy: null,
      ...(sourceArchiveBytes === undefined ? {} : { sourceArchiveBytes }),
    };
    expect(Schema.decodeUnknownSync(Stream.HqNavigationJob)(job)).toEqual(job);
  },
);
