import { describe, expect, it } from "vite-plus/test";

import {
  isWholeSha,
  parseDirtyVersionName,
  parseVersionName,
  resolveCommit,
  sameCommit,
} from "./versionName.ts";

const SHA = "7e2d4c1a9b3f5e6d8c0a1b2c3d4e5f6a7b8c9d0e";
const OTHER = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";

describe("parseVersionName", () => {
  it.each([
    { name: "an old stage name, the bare sha", value: SHA, expected: { sha: SHA } },
    {
      name: "an old production name, sha, tag and tagger",
      value: `${SHA} v0.1.0 Gitea`,
      expected: { sha: SHA, label: "v0.1.0", taggedBy: "Gitea" },
    },
    {
      name: "an old production name whose tagger has spaces",
      value: `${SHA} v0.1.0 Gitea Admin`,
      expected: { sha: SHA, label: "v0.1.0", taggedBy: "Gitea Admin" },
    },
    {
      name: "an old production name whose tagger was empty",
      value: `${SHA} v0.1.0 `,
      expected: { sha: SHA, label: "v0.1.0" },
    },
    {
      name: "an old production name whose tagger has a doubled space",
      value: `${SHA} v0.1.0  Gitea Admin`,
      expected: { sha: SHA, label: "v0.1.0", taggedBy: "Gitea Admin" },
    },
    {
      name: "an old production name with no tagger",
      value: `${SHA} v0.1.0`,
      expected: { sha: SHA, label: "v0.1.0" },
    },
    {
      name: "a stage name, branch then short sha",
      value: "main 7e2d4c1",
      expected: { sha: "7e2d4c1", label: "main" },
    },
    {
      name: "a production name, tag then short sha",
      value: "v0.1.0 7e2d4c1",
      expected: { sha: "7e2d4c1", label: "v0.1.0" },
    },
    {
      name: "a branch that looks like hex, still the label",
      value: "deadbeefcafe 7e2d4c1",
      expected: { sha: "7e2d4c1", label: "deadbeefcafe" },
    },
    { name: "an upper-case sha", value: SHA.toUpperCase(), expected: { sha: SHA } },
    {
      name: "a name with stray spaces",
      value: "  main   7e2d4c1 ",
      expected: { sha: "7e2d4c1", label: "main" },
    },
    { name: "a hand-made name", value: "hotfix for the outage", expected: undefined },
    { name: "a hand-made two-word name", value: "hotfix friday", expected: undefined },
    { name: "two words whose sha is too short", value: "main 7e2d4c", expected: undefined },
    {
      name: "two words whose sha is longer than seven",
      value: "main 7e2d4c1a",
      expected: undefined,
    },
    { name: "a hand-made name ending in a date", value: "release 20260930", expected: undefined },
    {
      name: "a hand-made name ending in a timestamp",
      value: "deploy 1727712000",
      expected: undefined,
    },
    { name: "three words a person typed", value: "deploy 7e2d4c1 again", expected: undefined },
    { name: "a bare short sha, which no writer ever wrote", value: "7e2d4c1", expected: undefined },
    { name: "zcp's old name of a dirty tree", value: `${SHA}-dirty`, expected: undefined },
    { name: "zcp's name of a dirty tree", value: "main 7e2d4c1-dirty", expected: undefined },
    {
      name: "zcp's name of a clean push",
      value: "main 7e2d4c1",
      expected: { sha: "7e2d4c1", label: "main" },
    },
    { name: "an empty name", value: "", expected: undefined },
    { name: "a blank name", value: "   ", expected: undefined },
    { name: "nothing", value: undefined, expected: undefined },
  ])("reads $name", ({ value, expected }) => {
    expect(parseVersionName(value)).toEqual(expected);
  });
});

describe("parseDirtyVersionName — zcp's push of a tree with uncommitted changes", () => {
  it.each([
    { name: "main 7e2d4c1-dirty", read: { label: "main", sha: "7e2d4c1" } },
    {
      name: "mate/mate-Pq7Zr0TestProject 7E2D4C1-dirty",
      read: { label: "mate/mate-Pq7Zr0TestProject", sha: "7e2d4c1" },
    },
    { name: "main 7e2d4c1", read: undefined },
    { name: "7e2d4c1-dirty", read: undefined },
    { name: "main 7e2d4-dirty", read: undefined },
    { name: undefined, read: undefined },
  ])("$name", ({ name, read }) => {
    expect(parseDirtyVersionName(name)).toEqual(read);
    // Built from no commit: never one to compare.
    expect(parseVersionName(name)).toEqual(
      name === "main 7e2d4c1" ? { sha: "7e2d4c1", label: "main" } : undefined,
    );
  });
});

describe("sameCommit", () => {
  it.each([
    { name: "the full sha", left: SHA, right: SHA, expected: true },
    { name: "the seven-hex prefix", left: "7e2d4c1", right: SHA, expected: true },
    {
      name: "a short commit, which nothing can check",
      left: SHA,
      right: "7e2d4c1",
      expected: false,
    },
    { name: "a longer prefix", left: "7e2d4c1a9b3f", right: SHA, expected: true },
    { name: "one short spelling, twice", left: "7e2d4c1", right: "7e2d4c1", expected: true },
    { name: "two short spellings", left: "7e2d4c1", right: "7e2d4c1a9", expected: false },
    { name: "upper case against lower", left: "7E2D4C1", right: SHA, expected: true },
    { name: "another commit's prefix", left: "3f9c1b2", right: SHA, expected: false },
    { name: "another full sha", left: OTHER, right: SHA, expected: false },
    { name: "a prefix shorter than seven", left: "7e2d4c", right: SHA, expected: false },
    { name: "a dirty tree's short token", left: "7e2d4c1-dirty", right: SHA, expected: false },
    { name: "a dirty tree's whole token", left: `${SHA}-dirty`, right: SHA, expected: false },
    { name: "nothing against a sha", left: undefined, right: SHA, expected: false },
    { name: "nothing against nothing", left: undefined, right: undefined, expected: false },
    { name: "empty against empty", left: "", right: "", expected: false },
  ])("says $name is $expected", ({ left, right, expected }) => {
    expect(sameCommit(left, right)).toBe(expected);
  });
});

describe("resolveCommit", () => {
  it.each([
    { name: "a full sha, which is itself", token: SHA, known: [], expected: SHA },
    {
      name: "a short sha one known commit begins",
      token: "7e2d4c1",
      known: [OTHER, SHA],
      expected: SHA,
    },
    {
      name: "a short sha nothing known begins",
      token: "7e2d4c1",
      known: [OTHER],
      expected: undefined,
    },
    {
      name: "a short sha two known commits begin, which is no answer",
      token: "7e2d4c1",
      known: [SHA, `7e2d4c1${"0".repeat(33)}`],
      expected: undefined,
    },
    { name: "the same commit known twice", token: "7e2d4c1", known: [SHA, SHA], expected: SHA },
    {
      name: "a short known commit, never an answer",
      token: "7e2d4c1",
      known: ["7e2d4c1a"],
      expected: undefined,
    },
    { name: "nothing", token: undefined, known: [SHA], expected: undefined },
  ])("resolves $name", ({ token, known, expected }) => {
    expect(resolveCommit(token, known)).toBe(expected);
  });
});

describe("a SHA-256 repository's whole sha", () => {
  const SHA256 = "7e2d4c1a".repeat(8);
  it.each([
    { name: "an old stage name", value: SHA256, expected: { sha: SHA256 } },
    {
      name: "an old production name",
      value: `${SHA256} v0.1.0 ada`,
      expected: { sha: SHA256, label: "v0.1.0", taggedBy: "ada" },
    },
    { name: "a new name", value: "main 7e2d4c1", expected: { sha: "7e2d4c1", label: "main" } },
  ])("reads $name", ({ value, expected }) => {
    expect(parseVersionName(value)).toEqual(expected);
  });

  it("is the commit its seven-hex prefix names", () => {
    expect(sameCommit("7e2d4c1", SHA256)).toBe(true);
    expect(resolveCommit("7e2d4c1", [SHA256])).toBe(SHA256);
    expect(isWholeSha(SHA256)).toBe(true);
    expect(isWholeSha(SHA256.slice(0, 50))).toBe(false);
  });
});
