import { describe, expect, it } from "vite-plus/test";

import {
  bumpVersion,
  highestTag,
  nextVersion,
  parseVersion,
  releaseNotes,
  releaseMessage,
} from "./release-mate.ts";

describe("parseVersion", () => {
  it.each([
    { text: "0.11.69", version: [0, 11, 69] },
    { text: "v1.2.3", version: [1, 2, 3] },
    { text: "0.11.69-rehearsal", version: undefined },
    { text: "nightly", version: undefined },
  ])("$text", ({ text, version }) => {
    expect(parseVersion(text)).toEqual(version);
  });
});

describe("highestTag", () => {
  it.each([
    {
      name: "compares numerically, not as text",
      lsRemote: "a1\trefs/tags/v0.9.4\nb2\trefs/tags/v0.11.68\nc3\trefs/tags/v0.11.9",
      tag: "0.11.68",
    },
    {
      name: "skips peeled refs and names that are no release",
      lsRemote: "a1\trefs/tags/v0.11.68\nb2\trefs/tags/v0.12.0^{}\nc3\trefs/tags/v0.13.0-nightly",
      tag: "0.11.68",
    },
    { name: "nothing published", lsRemote: "", tag: undefined },
  ])("$name", ({ lsRemote, tag }) => {
    expect(highestTag(lsRemote)).toBe(tag);
  });
});

describe("nextVersion", () => {
  it.each([
    { packages: "0.11.69", published: "0.11.69", bump: "patch", next: "0.11.70" },
    { packages: "0.11.69", published: "0.11.69", bump: "minor", next: "0.12.0" },
    // Another session released while this branch was open: the tag is ahead of the packages.
    { packages: "0.11.69", published: "0.11.70", bump: "patch", next: "0.11.71" },
    { packages: "0.11.69", published: undefined, bump: "patch", next: "0.11.70" },
  ] as const)(
    "$packages, published $published, $bump → $next",
    ({ packages, published, bump, next }) => {
      expect(nextVersion(packages, published, bump)).toBe(next);
    },
  );

  it("refuses a version that is no release", () => {
    expect(() => nextVersion("0.0.0-rehearsal", undefined, "patch")).toThrow(
      "not a release version",
    );
  });
});

describe("bumpVersion", () => {
  it("sets the one version line", () => {
    expect(
      bumpVersion('{\n  "name": "web",\n  "version": "0.11.69"\n}\n', "0.11.69", "0.11.70"),
    ).toBe('{\n  "name": "web",\n  "version": "0.11.70"\n}\n');
  });

  it.each([
    { name: "no line holds the version", json: '{ "version": "0.11.68" }', found: 0 },
    {
      name: "two lines hold it",
      json: '{ "version": "0.11.69", "x": { "version": "0.11.69" } }',
      found: 2,
    },
  ])("refuses when $name", ({ json, found }) => {
    expect(() => bumpVersion(json, "0.11.69", "0.11.70")).toThrow(`found ${found}`);
  });
});

describe("releaseNotes", () => {
  it("names each merged pull request by number and title, and a pushed commit by its subject", () => {
    const log = [
      "\x1eMerge pull request #38 from zeropsio/fix/pass-20\x1fPass 20: the Crew tab as approved\n",
      "\x1efix(web): the release lists read every tier's repos\x1f\n",
      "\x1eMerge pull request #39 from zeropsio/fix/pass-21\x1f\n",
    ].join("");
    expect(releaseNotes(log)).toBe(
      [
        "- #38 Pass 20: the Crew tab as approved",
        "- fix(web): the release lists read every tier's repos",
        "- #39 zeropsio/fix/pass-21",
      ].join("\n"),
    );
  });

  it("is empty when nothing reached main", () => {
    expect(releaseNotes("")).toBe("");
  });
});

it("release commits retain the lane Card trailer", () => {
  expect(releaseMessage("0.14.105", "- fix: retain recovery outcomes", "notices-s5")).toBe(
    "chore(release): mate 0.14.105\n\n- fix: retain recovery outcomes\n\nCard: notices-s5",
  );
});

it("releases outside a lane do not invent a Card trailer", () => {
  expect(releaseMessage("0.14.105", "- fix: retain recovery outcomes")).toBe(
    "chore(release): mate 0.14.105\n\n- fix: retain recovery outcomes",
  );
});
