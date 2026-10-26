import * as ReleaseSchemas from "./hqRelease.ts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CreateReleaseRequest,
  RELEASE_MESSAGE_REFUSALS,
  RELEASE_REFUSALS,
  RELEASES_SHOWN,
  Release,
  ReleaseTag,
  RollbackRequest,
  compareReleaseTags,
  nextPatch,
  parseReleaseMessage,
  releaseMessage,
  releaseTagOfVersion,
} from "./hqRelease.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const LONG = "c".repeat(64);

const read = (schema: Schema.Codec<unknown, unknown>, value: unknown) =>
  Schema.decodeUnknownExit(schema)(value)._tag;

describe("hqRelease", () => {
  it.each([
    ["1.0.0", "v1.0.0"],
    [" v2.0.0\n", "v2.0.0"],
    ["01.0.0", undefined],
    ["1.0", undefined],
    ["1.0.0-beta", undefined],
  ])("reads a declared or typed version %s", (version, tag) => {
    expect(releaseTagOfVersion(version)).toBe(tag);
  });
  it.each([
    ["one service", `api ${A}`, [{ service: "api", sha: A }]],
    [
      "services sorted, whatever the order written",
      `web ${B}\napi ${A}`,
      [
        { service: "api", sha: A },
        { service: "web", sha: B },
      ],
    ],
    [
      "blank and whitespace-only lines between entries",
      `\napi ${A}\n   \n\nweb ${B}\n`,
      [
        { service: "api", sha: A },
        { service: "web", sha: B },
      ],
    ],
    ["a line's own surrounding spaces", `  api ${A}  `, [{ service: "api", sha: A }]],
    ["spaces before the sha", `api    ${A}`, [{ service: "api", sha: A }]],
    ["a SHA-256 commit", `api ${LONG}`, [{ service: "api", sha: LONG }]],
    [
      "a hostname of 40 characters",
      `a${"b".repeat(39)} ${A}`,
      [{ service: `a${"b".repeat(39)}`, sha: A }],
    ],
    [
      "a service listed twice at one commit, once",
      `api ${A}\napi ${A}`,
      [{ service: "api", sha: A }],
    ],
  ])("reads a release's message: %s", (_name, message, entries) => {
    expect(parseReleaseMessage(message)).toEqual({ entries });
  });

  it.each([
    ["nothing", "", "release_empty"],
    ["only blank lines", "\n  \n\t\n", "release_empty"],
    ["a service at two commits", `api ${A}\napi ${B}`, "release_service_twice"],
    ["a line with a third field", `api ${A} extra`, "release_line_unreadable"],
    ["a line with no sha", "api", "release_line_unreadable"],
    ["a tab for the space", `api\t${A}`, "release_line_unreadable"],
    ["a hostname that starts with a digit", `1api ${A}`, "release_line_unreadable"],
    ["an uppercase hostname", `Api ${A}`, "release_line_unreadable"],
    ["a hostname of 41 characters", `a${"b".repeat(40)} ${A}`, "release_line_unreadable"],
    ["a hostname with a dash", `my-api ${A}`, "release_line_unreadable"],
    ["a short sha", `api ${A.slice(0, 7)}`, "release_line_unreadable"],
    ["a sha of 39 hex", `api ${A.slice(1)}`, "release_line_unreadable"],
    ["an uppercase sha", `api ${A.toUpperCase()}`, "release_line_unreadable"],
    // A line it cannot read refuses the whole message: half a release would deploy half an app.
    ["one odd line among good ones", `api ${A}\nweb ${B}\n# a comment`, "release_line_unreadable"],
  ])("refuses a release's message: %s", (_name, message, refused) => {
    expect(parseReleaseMessage(message)).toEqual({ refused });
    expect(RELEASE_MESSAGE_REFUSALS).toContain(refused);
  });

  it("writes a release's message one sorted line per service, and reads it back", () => {
    const entries = [
      { service: "web", sha: B },
      { service: "api", sha: A },
    ];
    expect(releaseMessage(entries)).toBe(`api ${A}\nweb ${B}\n`);
    expect(parseReleaseMessage(releaseMessage(entries))).toEqual({
      entries: [entries[1], entries[0]],
    });
  });

  it.each([
    ["the first release", [], "v0.1.0"],
    ["names that are no release", ["latest", "v1.2", "v1.2.3-rc1", "1.2.3"], "v0.1.0"],
    ["the patch over the newest", ["v0.1.0", "v0.1.1"], "v0.1.2"],
    ["the newest by version, never by name", ["v0.9.0", "v0.10.0", "v0.2.7"], "v0.10.1"],
    ["the newest, whatever the order given", ["v2.0.0", "v1.9.9"], "v2.0.1"],
    [
      "a version past what a number holds",
      ["v0.0.99999999999999999999"],
      "v0.0.100000000000000000000",
    ],
  ])("suggests the next release's name: %s", (_name, tags, next) => {
    expect(nextPatch(tags)).toBe(next);
  });

  it("orders release names by version, numerically", () => {
    expect(
      ["v0.9.0", "v0.10.0", "v1.0.0", "v0.10.2", "v0.1.0"].toSorted(compareReleaseTags),
    ).toEqual(["v0.1.0", "v0.9.0", "v0.10.0", "v0.10.2", "v1.0.0"]);
    expect(compareReleaseTags("v1.0.0", "v01.0.0")).toBe(0);
    expect(compareReleaseTags("v10000000000000000001.0.0", "v10000000000000000000.0.0")).toBe(1);
  });

  it.each([
    ["a release name", ReleaseTag, "v1.2.3", "Success"],
    ["a name with no patch", ReleaseTag, "v1.2", "Failure"],
    ["a pre-release", ReleaseTag, "v1.2.3-rc1", "Failure"],
    ["a name without its v", ReleaseTag, "1.2.3", "Failure"],
    [
      "a release asked for",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [{ service: "api", sha: B }] },
      "Success",
    ],
    [
      "a release of nothing",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [] },
      "Failure",
    ],
    [
      "a release naming a service twice",
      CreateReleaseRequest,
      {
        tag: "v0.1.0",
        groupHead: A,
        entries: [
          { service: "api", sha: B },
          { service: "api", sha: B },
        ],
      },
      "Failure",
    ],
    [
      "a release naming a service no hostname is",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [{ service: "API", sha: B }] },
      "Failure",
    ],
    [
      "a release of a short sha",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [{ service: "api", sha: "abc1234" }] },
      "Failure",
    ],
    ["a rollback", RollbackRequest, { groupHead: A }, "Success"],
    ["a rollback with no head read", RollbackRequest, {}, "Failure"],
    [
      "an approved release",
      Release,
      {
        tag: "v0.1.0",
        sha: A,
        entries: [{ service: "api", sha: B }],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "approved",
        reason: null,
        rollbackOf: null,
      },
      "Success",
    ],
    [
      "a rollback, by the release it goes back to",
      Release,
      {
        tag: "v0.1.2",
        sha: A,
        entries: [{ service: "api", sha: B }],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "approved",
        reason: null,
        rollbackOf: "v0.1.0",
      },
      "Success",
    ],
    [
      "a refused release",
      Release,
      {
        tag: "v0.1.1",
        sha: A,
        entries: [],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "refused",
        reason: "release_line_unreadable",
        rollbackOf: null,
      },
      "Success",
    ],
    [
      "a release of a state this build does not know",
      Release,
      {
        tag: "v0.1.0",
        sha: A,
        entries: [],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "pending",
        reason: null,
        rollbackOf: null,
      },
      "Failure",
    ],
  ])("reads %s", (_name, schema, value, expected) => {
    expect(read(schema as Schema.Codec<unknown, unknown>, value)).toBe(expected);
  });

  it("shows ten releases, as main's history did", () => {
    expect(RELEASES_SHOWN).toBe(10);
  });

  it("refuses a release by HQ's own reading, never by a message's", () => {
    expect(RELEASE_REFUSALS).toEqual([
      "group_moved",
      "production_moved",
      "no_group_main",
      "tag_taken",
      "tag_not_newer",
      "unknown_service",
      "entry_not_on_main",
      "release_not_approved",
      "git_release_blocked",
      "release_running",
    ]);
  });
});

const gitAttachment = {
  environmentId: "git-id",
  createdAt: "2026-10-13T10:00:00.000Z",
  target: { kind: "git", branch: "production", delivery: "direct" },
};
const gitPreflight = {
  repo: "App_Code-2",
  remote: {
    url: "https://github.com/acme/app.git",
    repositoryId: "42",
    keptAt: gitAttachment.createdAt,
    keptBy: "person",
    expiresAt: null,
    invalidSince: null,
  },
  ref: "refs/heads/production",
  before: A,
  sha: B,
  verdict: "ready",
  reason: null,
  checkedAt: gitAttachment.createdAt,
};
const legacyRelease = {
  tag: "v1.0.0",
  sha: A,
  entries: [{ service: "api", sha: B }],
  by: "person",
  at: "2026-10-13T10:00:00.000Z",
  state: "approved",
  reason: null,
  rollbackOf: null,
};

it("Old Zerops release JSON round-trips byte-identically with unknown historical provenance.", () => {
  const wire = JSON.stringify(legacyRelease);
  expect(
    JSON.stringify(Schema.encodeSync(Release)(Schema.decodeUnknownSync(Release)(JSON.parse(wire)))),
  ).toBe(wire);
  expect(parseReleaseMessage(releaseMessage(legacyRelease.entries))).toEqual({
    entries: legacyRelease.entries,
  });
});

it("A Git release freezes repository names and shas with its accepted attachment, keeping the service key.", () => {
  const value = {
    ...legacyRelease,
    target: "git",
    releaseTarget: gitAttachment,
    entries: [{ service: "App_Code-2", sha: LONG }],
  };
  expect(Schema.decodeUnknownExit(Release)(value)._tag).toBe("Success");
  const decoded = Schema.decodeUnknownSync(Release)(value);
  expect(Schema.encodeSync(Release)(decoded)).toEqual(value);
  expect(JSON.stringify(decoded)).not.toContain('"unit"');
  expect(Schema.decodeUnknownExit(Release)({ ...value, target: "zerops" })._tag).toBe("Failure");
  expect(Schema.decodeUnknownExit(Release)({ ...value, target: undefined })._tag).toBe("Failure");
});

it("An explicit Git release request carries the reviewed attachment and frozen repository roster.", () => {
  const value = {
    tag: "v1.0.0",
    groupHead: A,
    entries: [{ service: "App_Code-2", sha: B }],
    target: "git",
    releaseTarget: gitAttachment,
    preflight: [gitPreflight],
  };
  expect(Schema.decodeUnknownExit(CreateReleaseRequest)(value)._tag).toBe("Success");
  expect(Schema.decodeUnknownSync(CreateReleaseRequest)(value)).toEqual(value);
  for (const patch of [
    { releaseTarget: undefined },
    { target: undefined },
    { releaseTarget: { ...gitAttachment, createdAt: "bad" } },
    { releaseTarget: { ...gitAttachment, target: { kind: "zerops", projectId: "project" } } },
    { entries: [] },
    { entries: [value.entries[0], value.entries[0]] },
    { entries: [{ service: "App_Code-2", sha: "bad" }] },
  ]) {
    expect(Schema.decodeUnknownExit(CreateReleaseRequest)({ ...value, ...patch })._tag).toBe(
      "Failure",
    );
  }
});

it("Release message parsing dispatches repository names only for Git and leaves Zerops messages unchanged.", () => {
  const entries = [{ service: "App_Code-2", sha: B }];
  expect(parseReleaseMessage(releaseMessage(entries), "git")).toEqual({ entries });
  expect(parseReleaseMessage(releaseMessage(entries))).toEqual({
    refused: "release_line_unreadable",
  });
});

it("Rollouts retain the accepted attachment while old Zerops rollout provenance stays unknown.", () => {
  const old = { id: "9", tag: "v1.0.0", planned: true, ended: true, endedAt: null, leftOut: [] };
  expect(Schema.decodeUnknownSync(ReleaseSchemas.ReleaseRollout)(old)).toEqual(old);
  const git = { ...old, target: "git", releaseTarget: gitAttachment };
  expect(Schema.decodeUnknownSync(ReleaseSchemas.ReleaseRollout)(git)).toEqual(git);
  expect(
    Schema.decodeUnknownExit(ReleaseSchemas.ReleaseRollout)({ ...git, releaseTarget: undefined })
      ._tag,
  ).toBe("Failure");
});

it.each(["ready", "diverged", "credential", "declined", "unknown"])(
  "Git preflight preserves the host verdict %s without token data.",
  (verdict) => {
    const value = {
      repo: "App_Code-2",
      remote: {
        url: "https://github.com/acme/app.git",
        repositoryId: "42",
        keptAt: gitAttachment.createdAt,
        keptBy: "person",
        expiresAt: null,
        invalidSince: null,
      },
      ref: "refs/heads/production",
      before: A,
      sha: B,
      verdict,
      reason: null,
      checkedAt: gitAttachment.createdAt,
    };
    expect(Schema.decodeUnknownSync(ReleaseSchemas.HqGitReleasePreflight)(value)).toEqual(value);
    const decoded = Schema.decodeUnknownSync(ReleaseSchemas.HqGitReleasePreflight)({
      ...value,
      token: "TOKEN_MARKER",
      remote: { ...value.remote, token: "TOKEN_MARKER" },
    });
    expect(
      JSON.stringify(Schema.encodeSync(ReleaseSchemas.HqGitReleasePreflight)(decoded)),
    ).not.toContain("TOKEN_MARKER");
  },
);

it("Explicit Zerops release requests retain hostname validation and the reviewed project attachment.", () => {
  const value = {
    tag: "v1.0.0",
    groupHead: A,
    entries: [{ service: "api", sha: B }],
    target: "zerops",
    releaseTarget: {
      environmentId: "environment-id",
      createdAt: gitAttachment.createdAt,
      target: { kind: "zerops", projectId: "different-project-id" },
    },
  };
  expect(Schema.decodeUnknownSync(CreateReleaseRequest)(value)).toEqual(value);
  expect(
    Schema.decodeUnknownExit(CreateReleaseRequest)({
      ...value,
      entries: [{ service: "App_Code-2", sha: B }],
    })._tag,
  ).toBe("Failure");
  expect(
    Schema.decodeUnknownExit(CreateReleaseRequest)({ ...value, releaseTarget: undefined })._tag,
  ).toBe("Failure");
  const old = { tag: value.tag, groupHead: A, entries: value.entries };
  expect(Schema.decodeUnknownSync(CreateReleaseRequest)(old)).toEqual(old);
});

it("A Git release cannot submit a diverged or refused-token preflight or an unreviewed roster.", () => {
  const review = {
    repo: "App_Code-2",
    remote: {
      url: "https://github.com/acme/app.git",
      repositoryId: "42",
      keptAt: gitAttachment.createdAt,
      keptBy: "person",
      expiresAt: null,
      invalidSince: null,
    },
    ref: "refs/heads/production",
    before: A,
    sha: B,
    verdict: "ready",
    reason: null,
    checkedAt: gitAttachment.createdAt,
  };
  const value = {
    tag: "v1.0.0",
    groupHead: A,
    target: "git",
    releaseTarget: gitAttachment,
    entries: [{ service: review.repo, sha: B }],
    preflight: [review],
  };
  expect(Schema.decodeUnknownSync(CreateReleaseRequest)(value)).toEqual(value);
  for (const patch of [
    { preflight: undefined },
    { preflight: [] },
    { preflight: [{ ...review, verdict: "diverged" }] },
    { preflight: [{ ...review, verdict: "credential" }] },
    { preflight: [{ ...review, verdict: "unknown" }] },
    { preflight: [{ ...review, sha: A }] },
    { preflight: [{ ...review, repo: "Another_Repo" }] },
    { preflight: [{ ...review, ref: "refs/heads/staging" }] },
  ]) {
    expect(Schema.decodeUnknownExit(CreateReleaseRequest)({ ...value, ...patch })._tag).toBe(
      "Failure",
    );
  }
});

it("Release records retain domain history while older releases omit it.", () => {
  const value = {
    tag: "v1.0.0",
    sha: A,
    entries: [{ service: "api", sha: B }],
    by: "u1",
    at: "2026-10-26T09:25:00.000Z",
    state: "approved",
    reason: null,
    rollbackOf: null,
    history: {
      ranges: [{ repo: "api", base: A, head: B }],
      changes: [{ repo: "api", number: 7, title: "Search the catalogue" }],
      commitCount: 6,
      outsideCommitCount: 5,
    },
  };
  expect(Schema.decodeUnknownSync(Release)(value)).toEqual(value);
  const { history: _, ...legacy } = value;
  expect(Schema.decodeUnknownSync(Release)(legacy)).toEqual(legacy);
});
