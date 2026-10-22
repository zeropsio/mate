import type { GitBlob } from "@t3tools/shared/hqGitBrowse/blob";
import { describe, expect, it } from "vite-plus/test";
import { blameAges, noBlame } from "./blame.ts";

const blob = (patch: Partial<GitBlob>): GitBlob => ({
  path: "src/a.ts",
  blobSha: "b".repeat(40),
  size: 100,
  binary: false,
  content: "one\n",
  truncated: false,
  ...patch,
});

describe("blame", () => {
  it("A file over 256 KiB offers no blame and says why", () => {
    const cases: ReadonlyArray<readonly [string, Partial<GitBlob>, ReturnType<typeof noBlame>]> = [
      ["text file", {}, null],
      ["exactly 256 KiB", { size: 256 * 1024 }, null],
      ["one byte over", { size: 256 * 1024 + 1, truncated: true }, "too-large"],
      ["over 1 MiB", { size: 2 * 1024 * 1024, content: null }, "too-large"],
      ["binary file", { binary: true, content: null }, "not-text"],
      ["image", { path: "logo.png", binary: true, content: null }, "not-text"],
    ];
    for (const [name, patch, expected] of cases) expect(noBlame(blob(patch)), name).toBe(expected);
  });

  it("A line's shade says how long ago its commit was made, newest darkest", () => {
    const at = (sha: string, authoredAt: string) => ({ sha, authoredAt });
    expect([
      ...blameAges([
        at("new", "2026-10-21T00:00:00Z"),
        at("mid", "2026-04-21T00:00:00Z"),
        at("old", "2025-10-21T00:00:00Z"),
        at("older", "2025-10-21T00:00:01Z"),
      ]),
    ]).toEqual([
      ["new", 0],
      ["mid", 2],
      ["old", 4],
      ["older", 4],
    ]);
    expect([...blameAges([at("one", "2026-10-21T00:00:00Z")])]).toEqual([["one", 0]]);
  });
});
