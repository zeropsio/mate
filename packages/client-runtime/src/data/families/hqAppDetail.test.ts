import { describe, expect, it } from "vite-plus/test";

import { hqAppDetailFamily } from "./hqAppDetail.ts";

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
