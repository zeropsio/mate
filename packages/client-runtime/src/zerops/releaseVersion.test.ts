import { describe, expect, it } from "vite-plus/test";

import { releaseVersionField, releaseVersionSuggestions } from "./releaseVersion.ts";

describe("the person's release version", () => {
  it.each([
    ["1.0.0", ["v0.1.5"], "v1.0.0", undefined],
    [" v1.0.0 ", ["v0.1.5"], "v1.0.0", undefined],
    ["0.10.0", ["v0.9.9", "v0.8.0"], "v0.10.0", undefined],
    ["", [], undefined, "Enter a version."],
    ["1.0", [], undefined, "Use major.minor.patch, for example 1.0.0."],
    ["01.0.0", [], undefined, "Use major.minor.patch, for example 1.0.0."],
    ["1.0.0-beta", [], undefined, "Use major.minor.patch, for example 1.0.0."],
    ["0.1.5", ["v0.1.5"], "v0.1.5", "Choose a version newer than v0.1.5."],
    ["0.1.6", ["v1.0.0", "v0.1.5"], "v0.1.6", "Choose a version newer than v1.0.0."],
  ] as const)("checks %s over %s", (value, tags, tag, error) => {
    expect(releaseVersionField(value, tags)).toEqual({ tag, error });
  });

  it("offers only newer declared versions from the recipe and production repositories", () => {
    expect(
      releaseVersionSuggestions({
        tags: ["v0.1.5"],
        repositories: new Map([
          ["app", "appdev"],
          ["api", "api"],
        ]),
        repos: [
          {
            name: "appdev",
            mainHead: "a".repeat(40),
            updatedAt: "now",
            releaseVersion: { tag: "v1.0.0", path: "package.json" },
          },
          {
            name: "group",
            mainHead: "b".repeat(40),
            updatedAt: "now",
            releaseVersion: { tag: "v2.0.0", path: "VERSION" },
          },
          {
            name: "api",
            mainHead: "c".repeat(40),
            updatedAt: "now",
            releaseVersion: { tag: "v0.1.5", path: "VERSION" },
          },
          {
            name: "other",
            mainHead: "d".repeat(40),
            updatedAt: "now",
            releaseVersion: { tag: "v9.0.0", path: "VERSION" },
          },
        ],
      }),
    ).toEqual([
      { tag: "v1.0.0", source: "appdev/package.json" },
      { tag: "v2.0.0", source: "group/VERSION" },
    ]);
  });
});
