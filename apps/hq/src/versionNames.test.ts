import { assert, describe, it } from "@effect/vitest";

import { sameCommit, versionName, versionSha } from "./versionNames.ts";

const SHA = "7e2d4c1aa0b1c2d3e4f5061728394a5b6c7d8e9f";

describe("versionName", () => {
  // Main B16: the label a person reads it by, and the commit's seven hex.
  it("names a version for its label and the commit's short sha", () => {
    assert.strictEqual(versionName("main", SHA), "main 7e2d4c1");
    assert.strictEqual(versionName("v0.1.0", SHA), "v0.1.0 7e2d4c1");
  });
});

describe("versionSha", () => {
  // Every name main's broker ever wrote; anything named by hand has none.
  it.each([
    { name: "main 7e2d4c1", sha: "7e2d4c1" },
    { name: SHA, sha: SHA },
    { name: `${SHA} v0.1.0 Ada Lovelace`, sha: SHA },
    { name: `${SHA} v0.1.0`, sha: SHA },
    { name: "", sha: "" },
    { name: "release 20260930", sha: "" },
    { name: "main 7e2d4c1-dirty", sha: "" },
    { name: "main  7e2d4c1", sha: "" },
    { name: "hq-2a9f6c1.20261002T120000", sha: "" },
  ])("reads '$name' as '$sha'", ({ name, sha }) => {
    assert.strictEqual(versionSha(name), sha);
  });
});

describe("sameCommit", () => {
  it.each([
    { token: SHA, sha: SHA, same: true },
    { token: "7e2d4c1", sha: SHA, same: true },
    { token: "7e2d4c2", sha: SHA, same: false },
    { token: "7e2d4c", sha: SHA, same: false },
    { token: "", sha: SHA, same: false },
    { token: "7e2d4c1", sha: "7e2d4c1", same: true },
  ])("$token is $sha: $same", ({ token, sha, same }) => {
    assert.strictEqual(sameCommit(token, sha), same);
  });
});
