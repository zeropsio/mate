import * as Offers from "./hqOffers.ts";
import * as Changes from "./hqChanges.ts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CHANGE_BODY_MAX,
  CHANGE_TITLE_MAX,
  COMMENT_BODY_MAX,
  AttachmentResponse,
  ChangeListResponse,
  ChangeMetadataResponse,
  ChangesMessage,
  ChangesSnapshot,
  CommentListResponse,
  CompareQuery,
  CompareResponse,
  EditChangeRequest,
  EnsureRepoRequest,
  HqChange,
  ChangePipeline,
  CloseChangeRequest,
  MergeChangeRequest,
  MateChanges,
  OpenChangeRequest,
  OpenChangeResponse,
  PostCommentRequest,
  RepoListResponse,
  attachmentPath,
  changeRoutePath,
  changeUrl,
  mergeSubject,
  parseAttachmentUrl,
  parseChangeUrl,
  repoOfUrl,
  repoUrl,
} from "./hqChanges.ts";

const HQ = "https://hqzone.prg1-zerops.zone";
const APP = "0b7c4c1e-9f1d-4a43-8f43-6d2b8a1c2e10";
const decodeComments = Schema.decodeUnknownSync(CommentListResponse);
const decodeChange = Schema.decodeUnknownSync(HqChange);

describe("hqChanges — the change link", () => {
  it("names a change at HQ's address, reads it back, and routes it in the client", () => {
    const url = changeUrl(HQ, APP, "appdev", 7);
    expect(url).toBe(`${HQ}/changes/${APP}/appdev/7`);
    expect(parseChangeUrl(url, HQ)).toEqual({ appId: APP, repo: "appdev", number: 7 });
    // An official address written with a trailing slash names the same HQ.
    expect(changeUrl(`${HQ}/`, APP, "appdev", 7)).toBe(url);
    expect(parseChangeUrl(url, `${HQ}/`)).toEqual({ appId: APP, repo: "appdev", number: 7 });
    expect(changeRoutePath(APP, "appdev", 7)).toBe(`/change/${APP}/appdev/7`);
  });

  it("names where git reaches a repository at HQ's address, as zcp names a lease's repository", () => {
    expect(repoUrl(HQ, APP, "appdev")).toBe(`${HQ}/git/${APP}/appdev`);
    expect(repoUrl(`${HQ}/`, APP, "appdev")).toBe(`${HQ}/git/${APP}/appdev`);
  });

  // The shared HQ serves git at `/git/<orgId>/<appId>/<repo>.git`, the address it lists and zcp
  // names a lease's repository by; an HQ of one organization served `/git/<appId>/<repo>.git`.
  const ORG = "4KHK4MkhQ2yjEvRLE7a1Ag";
  const appdev = { hq: HQ, appId: APP, repo: "appdev" };
  it.each([
    {
      title: "the shared HQ's address as it lists it, with the organization and .git",
      address: `${HQ}/git/${ORG}/${APP}/appdev.git`,
      named: appdev,
    },
    {
      title: "the shared HQ's address as zcp names a lease's repository, canonical",
      address: `${HQ}/git/${ORG}/${APP}/appdev`,
      named: appdev,
    },
    {
      title: "an HQ of one organization's address, without one",
      address: repoUrl(HQ, APP, "appdev"),
      named: appdev,
    },
    {
      title: "an address with .git and a trailing slash",
      address: `${HQ}/git/${APP}/appdev.git/`,
      named: appdev,
    },
    {
      title: "an address escaped as HQ escapes its parts",
      address: `${HQ}/git/${ORG}/${encodeURIComponent("app 1")}/appdev.git`,
      named: { hq: HQ, appId: "app 1", repo: "appdev" },
    },
    {
      title: "an HQ served under a path",
      address: `${HQ}/hq/git/${ORG}/${APP}/appdev`,
      named: { ...appdev, hq: `${HQ}/hq` },
    },
    { title: "a repository on GitHub", address: "https://github.com/acme/appdev", named: null },
    { title: "a change's address", address: changeUrl(HQ, APP, "appdev", 7), named: null },
    { title: "an application's, naming no repository", address: `${HQ}/git/${APP}`, named: null },
    {
      title: "an address of more parts than an organization's",
      address: `${HQ}/git/x/${ORG}/${APP}/appdev`,
      named: null,
    },
    { title: "an address with an empty part", address: `${HQ}/git//${APP}/appdev`, named: null },
    { title: "an SSH address", address: `ssh://git@${HQ.slice(8)}/git/${APP}/appdev`, named: null },
    { title: "no address", address: "appdev", named: null },
  ])(
    "reads the repository a git address of HQ's names, never its organization: $title",
    ({ address, named }) => {
      expect(repoOfUrl(address)).toEqual(named);
    },
  );

  it.each([
    ["a query and a fragment", `${HQ}/changes/${APP}/appdev/7?tab=files#c3`, true],
    ["a trailing slash", `${HQ}/changes/${APP}/appdev/7/`, true],
    ["the host in capitals", `https://HQZONE.prg1-zerops.zone/changes/${APP}/appdev/7`, true],
    [
      "the same port spelled out",
      `https://hqzone.prg1-zerops.zone:443/changes/${APP}/appdev/7`,
      true,
    ],
    ["another host", `https://other.prg1-zerops.zone/changes/${APP}/appdev/7`, false],
    [
      "a host shaped like HQ's",
      `https://hqzone.prg1-zerops.zone.evil.example/changes/${APP}/a/7`,
      false,
    ],
    ["plain http", `http://hqzone.prg1-zerops.zone/changes/${APP}/appdev/7`, false],
    ["another port", `https://hqzone.prg1-zerops.zone:8443/changes/${APP}/appdev/7`, false],
    ["the client's route", `${HQ}/change/${APP}/appdev/7`, false],
    ["a path below the change", `${HQ}/changes/${APP}/appdev/7/files`, false],
    ["number zero", `${HQ}/changes/${APP}/appdev/0`, false],
    ["no number", `${HQ}/changes/${APP}/appdev/seven`, false],
    ["a number past the safe integers", `${HQ}/changes/${APP}/appdev/9007199254740993`, false],
    ["a repository no git layer takes", `${HQ}/changes/${APP}/-dev/7`, false],
    ["no url", "not a url", false],
  ])("%s", (_name, href, read) => {
    expect(parseChangeUrl(href, HQ) !== null).toBe(read);
  });

  it("recognises nothing without an official address", () => {
    expect(parseChangeUrl(changeUrl(HQ, APP, "appdev", 7), "")).toBeNull();
  });
});

describe("hqChanges — a picture of a change", () => {
  const ID = "4f1c2b9a-0d3e-4c55-9b8f-2a7e6d1c0b3a";

  it("is served at a path of HQ's API, which a description names at the official address", () => {
    const path = attachmentPath(APP, "appdev", 7, ID);
    expect(path).toBe(`/api/apps/${APP}/changes/appdev/7/attachments/${ID}`);
    expect(parseAttachmentUrl(`${HQ}${path}`, HQ)).toEqual({
      appId: APP,
      repo: "appdev",
      number: 7,
      id: ID,
    });
    expect(parseAttachmentUrl(`https://elsewhere.example${path}`, HQ)).toBeNull();
    expect(
      parseAttachmentUrl(`${HQ}/api/apps/${APP}/changes/appdev/0/attachments/${ID}`, HQ),
    ).toBeNull();
    expect(parseAttachmentUrl(`${HQ}${changeRoutePath(APP, "appdev", 7)}`, HQ)).toBeNull();
  });
});

const SHA = "a".repeat(40);

const change = (patch: Record<string, unknown> = {}) => ({
  appId: APP,
  repo: "appdev",
  number: 7,
  mateProjectId: "P_MATE",
  title: "Add a login page",
  body: "",
  state: "open",
  head: SHA,
  mergedSha: null,
  landedHead: null,
  openedAt: "2026-10-02T10:00:00.000Z",
  mergedAt: null,
  closedAt: null,
  updatedAt: "2026-10-02T10:05:00.000Z",
  mergeability: "clean",
  behind: false,
  ...patch,
});

describe("hqChanges — the wire", () => {
  const read = (schema: Schema.Codec<unknown, unknown>, value: unknown) =>
    Schema.decodeUnknownExit(schema)(value)._tag;

  it.each([
    ["an open change", {}, "Success"],
    ["a change with no head yet", { head: null }, "Success"],
    [
      "a merged change",
      {
        state: "merged",
        mergedSha: "b".repeat(64),
        landedHead: SHA,
        mergedAt: "2026-10-02T11:00:00Z",
      },
      "Success",
    ],
    ["a title of the most characters", { title: "🙂".repeat(CHANGE_TITLE_MAX) }, "Success"],
    ["a title past them", { title: "🙂".repeat(CHANGE_TITLE_MAX + 1) }, "Failure"],
    ["a blank title", { title: "  " }, "Failure"],
    ["a body of the most characters", { body: "🙂".repeat(CHANGE_BODY_MAX) }, "Success"],
    ["a body past them", { body: "x".repeat(CHANGE_BODY_MAX + 1) }, "Failure"],
    ["a body holding a NUL, which no text in HQ keeps", { body: "a\u0000b" }, "Failure"],
    ["a title holding a NUL", { title: "a\u0000b" }, "Failure"],
    ["number zero", { number: 0 }, "Failure"],
    ["a fractional number", { number: 1.5 }, "Failure"],
    ["a head that is no commit", { head: "main" }, "Failure"],
    ["a state this build does not know", { state: "draft" }, "Failure"],
    ["a change behind main, in conflict", { mergeability: "conflict", behind: true }, "Success"],
    ["a change not judged yet", { mergeability: "unknown" }, "Success"],
    ["a mergeability this build does not know", { mergeability: "maybe" }, "Failure"],
    ["a change with no time of its last move", { updatedAt: undefined }, "Failure"],
    ["a repository no git layer takes", { repo: "a/b" }, "Failure"],
    ["a change with its comments counted", { comments: 3 }, "Success"],
    ["a count of comments below none", { comments: -1 }, "Failure"],
    ["a fractional count of comments", { comments: 1.5 }, "Failure"],
    ["a draft", { ready: false }, "Success"],
    ["a readiness that is no boolean", { ready: "yes" }, "Failure"],
  ])("a change: %s", (_name, patch, expected) => {
    expect(read(HqChange, change(patch))).toBe(expected);
  });

  it.each([
    ["ensure a repository", EnsureRepoRequest, { name: "appdev" }, "Success"],
    ["ensure a repository no git layer takes", EnsureRepoRequest, { name: "../x" }, "Failure"],
    ["open a change", OpenChangeRequest, { repo: "appdev", title: "Mate: appdev" }, "Success"],
    ["open a change without a title", OpenChangeRequest, { repo: "appdev", title: "" }, "Failure"],
    ["the change opened", OpenChangeResponse, { change: change(), created: true }, "Success"],
    ["retitle a change", EditChangeRequest, { title: "Add a login page" }, "Success"],
    ["describe a change", EditChangeRequest, { body: "It adds **a login page**." }, "Success"],
    ["an edit of nothing", EditChangeRequest, {}, "Failure"],
  ])("a Mate's request: %s", (_name, schema, value, expected) => {
    expect(read(schema as Schema.Codec<unknown, unknown>, value)).toBe(expected);
  });

  it.each([
    [
      "an application's repositories",
      RepoListResponse,
      {
        repos: [
          { name: "appdev", mainHead: SHA, updatedAt: "2026-10-02T10:00:00.000Z" },
          { name: "group", mainHead: null, updatedAt: "2026-10-02T09:00:00.000Z" },
        ],
      },
      "Success",
    ],
    ["an application with none", RepoListResponse, { repos: [] }, "Success"],
    [
      "a repository with a short head",
      RepoListResponse,
      { repos: [{ name: "appdev", mainHead: "abc1234", updatedAt: "2026-10-02T10:00:00.000Z" }] },
      "Failure",
    ],
    [
      "a picture kept",
      AttachmentResponse,
      { id: "4f1c2b9a", path: `/api/apps/${APP}/changes/appdev/7/attachments/4f1c2b9a` },
      "Success",
    ],
    ["a Mate in no application", MateChanges, { appId: null, changes: [] }, "Success"],
    [
      "a Mate's changes, settled and open",
      MateChanges,
      {
        appId: APP,
        changes: [
          {
            repo: "appdev",
            number: 8,
            state: "open",
            head: null,
            mergedSha: null,
            landedHead: null,
          },
          {
            repo: "appdev",
            number: 7,
            state: "merged",
            head: SHA,
            mergedSha: SHA,
            landedHead: SHA,
          },
          { repo: "api", number: 2, state: "closed", head: SHA, mergedSha: null, landedHead: null },
        ],
      },
      "Success",
    ],
    [
      "an HQ that keeps an open change per branch, its open change judged",
      MateChanges,
      {
        appId: APP,
        openPerBranch: true,
        changes: [
          {
            repo: "appdev",
            number: 8,
            state: "open",
            head: SHA,
            mergedSha: null,
            landedHead: null,
            branch: "badge",
            ready: false,
            mergeability: "clean",
            behind: true,
            updatedAt: "2026-10-25T10:00:00.000Z",
          },
        ],
      },
      "Success",
    ],
    [
      "an open change judged in a way this build does not know",
      MateChanges,
      {
        appId: APP,
        changes: [
          {
            repo: "appdev",
            number: 8,
            state: "open",
            head: SHA,
            mergedSha: null,
            landedHead: null,
            mergeability: "sideways",
          },
        ],
      },
      "Failure",
    ],
    [
      "an HQ that says it keeps one open change per repository in a word it never says",
      MateChanges,
      { appId: APP, openPerBranch: false, changes: [] },
      "Failure",
    ],
    [
      "a change of a state this build does not know",
      MateChanges,
      {
        appId: APP,
        changes: [
          {
            repo: "appdev",
            number: 1,
            state: "gone",
            head: null,
            mergedSha: null,
            landedHead: null,
          },
        ],
      },
      "Failure",
    ],
  ])("a Mate's answer: %s", (_name, schema, value, expected) => {
    expect(read(schema as Schema.Codec<unknown, unknown>, value)).toBe(expected);
  });

  const landed = {
    sha: "b".repeat(40),
    subject: "Add a login page (#7)",
    authorName: "Ada",
    at: "2026-10-02T10:00:00Z",
  };
  const comment = (body: string) => ({
    id: "c1",
    authorUserId: "owner",
    body,
    createdAt: "2026-10-02T10:05:00Z",
  });

  it.each([
    [
      "an application's changes",
      ChangeListResponse,
      { changes: [change(), change({ number: 6 })] },
      "Success",
    ],
    ["a change's comments", CommentListResponse, { comments: [comment("Looks good")] }, "Success"],
    [
      "a Mate's comment, brought over from Gitea",
      CommentListResponse,
      { comments: [{ ...comment("Done."), authorUserId: null, authorMateProjectId: "P_MATE" }] },
      "Success",
    ],
    ["say something", PostCommentRequest, { body: "Please rename it." }, "Success"],
    ["say nothing", PostCommentRequest, { body: " " }, "Failure"],
    ["say too much", PostCommentRequest, { body: "x".repeat(COMMENT_BODY_MAX + 1) }, "Failure"],
    ["compare from a commit", CompareQuery, { base: SHA, head: "b".repeat(40) }, "Success"],
    ["compare from the root", CompareQuery, { head: SHA }, "Success"],
    ["compare up to a branch's name", CompareQuery, { head: "main" }, "Failure"],
    [
      "what lies between two commits, one landed by a change and one by nobody's",
      CompareResponse,
      {
        base: SHA,
        head: "b".repeat(40),
        commits: [
          {
            ...landed,
            change: { number: 7, title: "Add a login page", mateProjectId: "P_MATE" },
          },
          { ...landed, sha: "c".repeat(40), subject: "Recipe: stage", change: null },
        ],
        truncated: false,
        total: 2,
      },
      "Success",
    ],
    [
      "everything up to a commit, cut at the bound",
      CompareResponse,
      {
        base: null,
        head: SHA,
        commits: [{ ...landed, change: null }],
        truncated: true,
        total: 10000,
      },
      "Success",
    ],
    [
      "a count below none",
      CompareResponse,
      { base: null, head: SHA, commits: [], truncated: false, total: -1 },
      "Failure",
    ],
  ])("a person's read: %s", (_name, schema, value, expected) => {
    expect(read(schema as Schema.Codec<unknown, unknown>, value)).toBe(expected);
  });

  it("reads a change from an HQ that counted no comments as uncounted", () => {
    expect(decodeChange(change()).comments).toBeNull();
  });

  it.each([
    ["an HQ that knows no drafts", {}, true],
    ["a draft", { ready: false }, false],
    ["a change described at its head", { ready: true }, true],
  ])("reads whether a change asks for review from %s", (_name, patch, ready) => {
    expect(decodeChange(change(patch)).ready).toBe(ready);
  });

  it.each([
    ["an HQ that does not record it", {}, undefined],
    ["the first code merge", { firstCodeMerge: true }, true],
    ["a later one", { firstCodeMerge: false }, false],
  ])("reads whether a merge was its application's first from %s", (_name, patch, first) => {
    expect(decodeChange(change(patch)).firstCodeMerge).toBe(first);
    expect(read(HqChange, change({ firstCodeMerge: "yes" }))).toBe("Failure");
  });

  it("reads a comment from an HQ that kept only people's as a person's", () => {
    const [said] = decodeComments({ comments: [comment("Looks good")] }).comments;
    expect([said?.authorUserId, said?.authorMateProjectId]).toEqual(["owner", null]);
  });

  it.each([
    [
      "a snapshot's changes, by application",
      ChangesSnapshot,
      { [APP]: [change()], other: [] },
      "Success",
    ],
    [
      "an application's changes now",
      ChangesMessage,
      { type: "changes", appId: APP, changes: [change()] },
      "Success",
    ],
    [
      "an application gone from view",
      ChangesMessage,
      { type: "changes", appId: APP, changes: null },
      "Success",
    ],
    ["a structure change", ChangesMessage, { type: "change", key: APP, value: null }, "Failure"],
  ])("the stream: %s", (_name, schema, value, expected) => {
    expect(read(schema as Schema.Codec<unknown, unknown>, value)).toBe(expected);
  });
});

describe("hqChanges — a repository", () => {
  it("A repository's HQ address survives the read", () => {
    const url = "https://hq.example/git/org-1/app-1/code.git";
    const { repos } = Schema.decodeUnknownSync(RepoListResponse)({
      repos: [{ name: "code", mainHead: null, updatedAt: "2026-10-01T00:00:00.000Z", url }],
    });
    expect(repos[0]?.url).toBe(url);
  });
});

describe("hqChanges — a merge", () => {
  it("is asked with the head the person was shown, never with main", () => {
    const read = (value: unknown) => Schema.decodeUnknownExit(MergeChangeRequest)(value)._tag;
    expect(read({ expectedHead: SHA })).toBe("Success");
    expect(read({ expectedHead: "HEAD" })).toBe("Failure");
    expect(read({})).toBe("Failure");
  });

  it("lands as Gitea's squash did: the change's title, its number after it", () => {
    expect(mergeSubject("Add a login page", 7)).toBe("Add a login page (#7)");
  });
});

describe("head-scoped review evidence", () => {
  it.each(["required", "advisory", "unknown"] as const)(
    "retains %s check evidence for its exact head",
    (requirement) => {
      const pipeline = {
        head: "a".repeat(40),
        requirements: "unknown",
        checks: [{ id: "build", name: "Build", requirement, state: "running" }],
      };
      expect(Schema.decodeUnknownSync(ChangePipeline)(pipeline)).toEqual(pipeline);
    },
  );
  it.each([null, "a".repeat(40)])(
    "carries the reviewed head even before a first push (%s)",
    (expectedHead) => {
      expect(Schema.decodeUnknownSync(CloseChangeRequest)({ expectedHead })).toEqual({
        expectedHead,
      });
      expect(() => Schema.decodeUnknownSync(CloseChangeRequest)({})).toThrow();
    },
  );
});

it("Repository metadata serializes the verified remote and never its token.", () => {
  const remote = {
    url: "https://github.com/acme/app.git",
    repositoryId: "42",
    keptAt: "2026-10-13T10:00:00.000Z",
    keptBy: "person",
    expiresAt: null,
    invalidSince: null,
  };
  const value = { name: "App_Code-2", mainHead: "a".repeat(40), updatedAt: remote.keptAt, remote };
  expect(Schema.decodeUnknownSync(RepoListResponse)({ repos: [value] })).toEqual({
    repos: [value],
  });
  const decoded = Schema.decodeUnknownSync(RepoListResponse)({
    repos: [{ ...value, remote: { ...remote, token: "TOKEN_MARKER" } }],
  });
  expect(JSON.stringify(Schema.encodeSync(RepoListResponse)(decoded))).not.toContain(
    "TOKEN_MARKER",
  );
});

it("Only mutating remote inputs carry a token and unsafe remote URLs refuse.", () => {
  expect(Changes).toHaveProperty("KeepRepoRemoteRequest");
  const value = { url: "https://github.com/acme/app.git", token: "TOKEN_MARKER" };
  expect(Schema.decodeUnknownSync(Changes.KeepRepoRemoteRequest)(value)).toEqual(value);
  for (const url of [
    "http://github.com/acme/app",
    "ssh://git@github.com/acme/app",
    "https://user:TOKEN_MARKER@github.com/acme/app",
    "https://github.com/acme/app?token=TOKEN_MARKER",
    "https://github.com/acme/app#TOKEN_MARKER",
    "https://github.com",
    "not a URL",
    "https://github.com/acme/%zz",
    "https://github.com/acme/../app",
  ]) {
    expect(Schema.decodeUnknownExit(Changes.KeepRepoRemoteRequest)({ ...value, url })._tag).toBe(
      "Failure",
    );
  }
});

it("Direct branch creation requires the reviewed remote and main tips and cannot request PR or tag delivery.", () => {
  expect(Changes).toHaveProperty("AddGitEnvironmentRequest");
  const value = {
    tier: "production",
    name: "Production",
    target: { kind: "git", branch: "production", delivery: "direct" },
    adoption: [
      {
        repo: "App_Code-2",
        remote: { url: "https://github.com/acme/app.git", repositoryId: "42" },
        branch: "production",
        mainHead: "a".repeat(40),
        remoteHead: "b".repeat(40),
        changedFiles: 3,
        seed: false,
      },
    ],
  };
  expect(Schema.decodeUnknownSync(Changes.AddGitEnvironmentRequest)(value)).toEqual(value);
  for (const patch of [
    { target: { ...value.target, delivery: "pr" } },
    { target: { ...value.target, kind: "tag" } },
    { adoption: [] },
    { adoption: [{ ...value.adoption[0], mainHead: "bad" }] },
    { adoption: [{ ...value.adoption[0], remoteHead: "bad" }] },
    { adoption: [{ ...value.adoption[0], changedFiles: -1 }] },
    { adoption: [{ ...value.adoption[0], branch: "staging" }] },
  ]) {
    expect(
      Schema.decodeUnknownExit(Changes.AddGitEnvironmentRequest)({ ...value, ...patch })._tag,
    ).toBe("Failure");
  }
});

it("Probe and adoption responses retain only safe evidence and reject partial modern records.", () => {
  const remote = {
    url: "https://github.com/acme/app.git",
    repositoryId: "42",
    keptAt: "2026-10-13T10:00:00.000Z",
    keptBy: "person",
    expiresAt: null,
    invalidSince: null,
  };
  const probe = { ok: true, remote };
  expect(Schema.decodeUnknownSync(Changes.HqRemoteProbe)(probe)).toEqual(probe);
  for (const patch of [
    { repositoryId: undefined },
    { keptAt: "bad" },
    { expiresAt: "bad" },
    { invalidSince: "bad" },
  ]) {
    expect(
      Schema.decodeUnknownExit(Changes.HqRemoteProbe)({ ...probe, remote: { ...remote, ...patch } })
        ._tag,
    ).toBe("Failure");
  }
  for (const value of [
    { ok: false, reason: "credential", status: 401 },
    { ok: false, reason: "rate_limit", status: 403, retryAt: remote.keptAt },
  ]) {
    expect(Schema.decodeUnknownSync(Changes.HqRemoteProbe)(value)).toEqual(value);
  }
  expect(
    JSON.stringify(
      Schema.decodeUnknownSync(Changes.HqRemoteProbe)({
        ...probe,
        token: "TOKEN_MARKER",
        remote: { ...remote, token: "TOKEN_MARKER" },
      }),
    ),
  ).not.toContain("TOKEN_MARKER");
});

it("Direct-target verbs travel through the existing open offers without a second permission verdict.", () => {
  expect(Offers.HQ_GIT_TARGET_VERBS).toEqual([
    "connect_remote",
    "replace_remote_token",
    "update_remote_address",
    "disconnect_remote",
    "add_git_environment",
    "remove_git_environment",
  ]);
  for (const verb of Offers.HQ_GIT_TARGET_VERBS) {
    expect(
      Offers.hqOffer({ [verb]: { allow: false, reason: "not_writer" } }, verb, {
        current: true,
        unavailableSince: null,
      }),
    ).toEqual({ kind: "refused", reason: "not_writer" });
  }
});

describe("hqChanges — a change's metadata", () => {
  const CHANGE = decodeChange({
    appId: APP,
    repo: "appdev",
    number: 7,
    mateProjectId: "p1",
    title: "t",
    body: "",
    state: "open",
    head: "a".repeat(40),
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-10-02T09:00:00.000Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-10-02T09:00:00.000Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: 0,
  });
  const decode = Schema.decodeUnknownSync(ChangeMetadataResponse);

  it("carries the files, merge base and conflicts HQ recorded", () => {
    const review = {
      mergeBase: "b".repeat(40),
      files: [{ path: "a.ts", added: 1, deleted: 0, binary: false, status: "A" as const }],
      filesTruncated: false,
      conflictPaths: [],
      commits: null,
      commitsTruncated: false,
    };
    expect(decode({ change: CHANGE, review }).review).toEqual(review);
  });
});
