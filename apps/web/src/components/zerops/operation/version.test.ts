import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import { versionLabel } from "./version";

describe("versionLabel — what a settled card names as the version it shipped", () => {
  it.each<{
    readonly name: string;
    readonly version: ZeropsOperation["version"];
    readonly label: string | undefined;
  }>([
    { name: "no version", version: undefined, label: undefined },
    { name: "an empty version", version: {}, label: undefined },
    {
      name: "a full commit sha is shortened to 7",
      version: { id: "av-1", name: "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39" },
      label: "3f2a9c1",
    },
    {
      name: "a name that is not a full sha is kept whole",
      version: { id: "av-1", name: "release-42" },
      label: "release-42",
    },
    {
      name: "a short sha is kept whole",
      version: { name: "abc123" },
      label: "abc123",
    },
    {
      name: "a Mate's own branch: its short sha alone",
      version: { name: "mate/mate-Pq7Zr0TestProject0000A 227b804" },
      label: "227b804",
    },
    { name: "a stage's branch and sha", version: { name: "main 7e2d4c1" }, label: "main 7e2d4c1" },
    {
      name: "a Mate's push of uncommitted changes: its sha, never its branch's machine name",
      version: { name: "mate/mate-Pq7Zr0TestProject0000A 227b804-dirty" },
      label: "227b804 · uncommitted",
    },
    {
      name: "a branch's push of uncommitted changes",
      version: { name: "main 7e2d4c1-dirty" },
      label: "main 7e2d4c1 · uncommitted",
    },
    {
      name: "a release's tag and sha",
      version: { name: "v0.1.0 7e2d4c1" },
      label: "v0.1.0 7e2d4c1",
    },
    {
      name: "an old production name: its tag and short sha, never its tagger",
      version: { name: "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39 v0.0.9 Ada" },
      label: "v0.0.9 3f2a9c1",
    },
    {
      name: "without a name, the platform's appVersion id",
      version: { id: "Xk3vQp9aRr2" },
      label: "Xk3vQp9aRr2",
    },
  ])("$name", ({ version, label }) => {
    expect(versionLabel(version)).toBe(label);
  });
});
