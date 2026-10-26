import { describe, expect, it } from "vite-plus/test";

import { hqAppDetailFamily } from "./hqAppDetail.ts";
import { gitRemote, gitPreflight, gitAdoption } from "../__fixtures__/hqWire.ts";

const hq = hqAppDetailFamily.hq!;
const owner = { orgId: "org", ownerId: "shop" };
const SHA = "a".repeat(40);
const release = {
  tag: "v1.0.0",
  sha: SHA,
  entries: [{ service: "api", sha: SHA }],
  by: "ada",
  at: "2026-10-06T00:00:00Z",
  state: "approved",
  reason: null,
  rollbackOf: null,
};
const repo = { name: "api", mainHead: SHA, updatedAt: "2026-10-06T00:00:00Z" };
const change = {
  appId: "shop",
  repo: "api",
  number: 1,
  mateProjectId: "ada",
  title: "Add a page",
  body: "",
  state: "open",
  head: SHA,
  mergedSha: null,
  landedHead: null,
  openedAt: "2026-10-06T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  updatedAt: "2026-10-06T00:00:00Z",
  mergeability: "clean",
  behind: false,
  ready: true,
  comments: null,
};
const tier = { state: "present", importYaml: "services:\n  - hostname: api\n", mainHead: SHA };

describe("hqAppDetailFamily", () => {
  it.each([
    { key: "probe:web", raw: { ok: true, remote: gitRemote }, kind: "probe" },
    { key: "preflight:web", raw: gitPreflight, kind: "preflight" },
    { key: "adoption:web", raw: gitAdoption, kind: "adoption" },
    { key: "delivery", raw: { jobs: [], note: "No remote for api" }, kind: "delivery" },
  ])("Git $key rides existing app-detail with no project demand", ({ key, raw, kind }) => {
    expect(hq.idOf(key, owner)).toBe(`shop/${key}`);
    expect(hq.keyOf(`shop/${key}`, owner)).toBe(key);
    expect(hq.decode(raw, key)).toMatchObject({ kind, value: raw });
  });
  it.each([
    { raw: { state: "pending" } },
    { raw: { state: "known", changes: [{ repo: "api", number: 3, title: "Add a page" }] } },
  ])("the release's recorded changes decode from $raw", ({ raw }) => {
    expect(hq.decode(raw, "releaseChanges")).toEqual({ kind: "releaseChanges", value: raw });
  });
  it("reads a release's recorded changes that HQ said malformed as not known", () => {
    expect(hq.decode({ state: "known" }, "releaseChanges")).toBeNull();
  });
  it("accepted Git release keeps its exact attachment, repository roster and shas", () => {
    const value = {
      ...release,
      target: "git",
      releaseTarget: {
        environmentId: "production-git",
        createdAt: "2026-10-13T00:00:00Z",
        target: { kind: "git", branch: "main", delivery: "direct" },
      },
      entries: [{ service: "web", sha: SHA }],
    };
    expect(hq.decode([value], "releases")).toEqual({ kind: "releases", value: [value] });
  });
  it.each([undefined, null])(
    "an omitted remote preserves custody while explicit disconnection replaces it: %s",
    (remote) => {
      const held = hq.decode([{ ...repo, remote: gitRemote }], "repos")!;
      const row = hq.decode([{ ...repo, ...(remote === undefined ? {} : { remote }) }], "repos")!;
      expect(hqAppDetailFamily.keepUnsaid!(held, row, false)).toEqual({
        kind: "repos",
        value: [{ ...repo, ...(remote === null ? { remote: null } : { remote: gitRemote }) }],
      });
    },
  );
  it.each([
    { key: "releases", id: "shop/releases" },
    { key: "repos", id: "shop/repos" },
    { key: "recipe:mate", id: "shop/recipe:mate" },
    { key: "recipe:stage", id: "shop/recipe:stage" },
    { key: "recipe:production", id: "shop/recipe:production" },
    { key: "changes", id: "shop/changes" },
    { key: "environments", id: null },
  ])("names the record $key of one application as $id", ({ key, id }) => {
    expect(hq.idOf(key, owner)).toBe(id);
    if (id !== null) expect(hq.keyOf(id, owner)).toBe(key);
  });

  it.each([
    { key: "releases", raw: [release], value: { kind: "releases", value: [release] } },
    { key: "repos", raw: [repo], value: { kind: "repos", value: [repo] } },
    { key: "changes", raw: [change], value: { kind: "changes", value: [change] } },
    { key: "recipe:stage", raw: tier, value: { kind: "recipe", value: tier } },
    {
      key: "recipe:production",
      raw: { state: "absent" },
      value: { kind: "recipe", value: { state: "absent" } },
    },
    { key: "releases", raw: [], value: { kind: "releases", value: [] } },
    { key: "repos", raw: [], value: { kind: "repos", value: [] } },
    { key: "changes", raw: [], value: { kind: "changes", value: [] } },
    { key: "releases", raw: [{ tag: "nope" }], value: null },
    { key: "releases", raw: [repo], value: null },
    { key: "repos", raw: [release], value: null },
    { key: "recipe:mate", raw: [release], value: null },
    { key: "environments", raw: [], value: null },
  ])("reads $key from $raw", ({ key, raw, value }) => {
    expect(hq.decode(raw, key)).toEqual(value);
  });

  it("observes the application's own app-detail scope", () => {
    expect(hq.wireScope?.("shop")).toEqual({ kind: "app-detail", appId: "shop" });
  });
});
