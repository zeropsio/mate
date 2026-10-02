import type { ChangeDetailResponse, ChangeFile, HqChange } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import { changeReadout } from "./changeReadout.ts";

const MAIN = "a".repeat(40);
const BASE = "b".repeat(40);
const HEAD = "c".repeat(40);

const change: HqChange = {
  appId: "g1",
  repo: "appdev",
  number: 2,
  mateProjectId: "p-nova",
  title: "Add a /status page",
  body: "",
  state: "open",
  head: HEAD,
  mergedSha: null,
  landedHead: null,
  openedAt: "2026-10-02T09:00:00.000Z",
  mergedAt: null,
  closedAt: null,
  updatedAt: "2026-10-02T09:00:00.000Z",
  mergeability: "clean",
  behind: false,
};

/** `git diff` for one path, as HQ hands a file's patch over: its header, then its hunks. */
const patch = (path: string, mode: string | null, hunks: string) =>
  [
    `diff --git a/${path} b/${path}`,
    ...(mode === null ? [] : [mode]),
    `index 1111111..2222222`,
    `--- ${mode?.startsWith("new") === true ? "/dev/null" : `a/${path}`}`,
    `+++ ${mode?.startsWith("deleted") === true ? "/dev/null" : `b/${path}`}`,
    hunks,
  ].join("\n");

const file = (over: Partial<ChangeFile> & Pick<ChangeFile, "path">): ChangeFile => ({
  added: 1,
  deleted: 0,
  hunks: patch(over.path, null, "@@ -1 +1,2 @@\n line\n+added\n"),
  binary: false,
  truncated: false,
  ...over,
});

const detail = (over: Partial<ChangeDetailResponse> = {}): ChangeDetailResponse => ({
  change,
  mainHead: MAIN,
  mergeBase: MAIN,
  mergeability: { kind: "clean" },
  files: [],
  filesTruncated: false,
  commits: [],
  commitsTruncated: false,
  ...over,
});

describe("changeReadout: a change's review as HQ's detail reads it", () => {
  it.each([
    ["a file the change adds", "new file mode 100644", "added"],
    ["a file the change deletes", "deleted file mode 100644", "deleted"],
    ["a file the change edits", null, "modified"],
  ] as const)("names %s by its patch's header", (_name, mode, status) => {
    const read = changeReadout(
      detail({
        files: [file({ path: "src/a.ts", hunks: patch("src/a.ts", mode, "@@ -1 +1 @@") })],
      }),
    );
    expect(read.files.map((entry) => entry.status)).toEqual([status]);
  });

  it("counts a file's lines, and none for a binary one", () => {
    const read = changeReadout(
      detail({
        files: [
          file({ path: "src/a.ts", added: 4, deleted: 2 }),
          file({ path: "logo.png", added: null, deleted: null, binary: true, hunks: "" }),
        ],
      }),
    );
    expect(read.files).toEqual([
      { path: "src/a.ts", status: "modified", additions: 4, deletions: 2 },
      { path: "logo.png", status: "modified", additions: 0, deletions: 0 },
    ]);
  });

  it("reads each file's diff from its own patch, cut where HQ cut it", () => {
    const read = changeReadout(
      detail({
        files: [
          file({ path: "src/a.ts" }),
          file({
            path: "src/b.ts",
            truncated: true,
            hunks: patch("src/b.ts", null, "@@ -1 +1 @@\n+x\n+y"),
          }),
        ],
      }),
    );
    expect(read.diff.get("src/a.ts")?.hunks[0]?.lines).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, text: "line" },
      { kind: "add", oldLine: null, newLine: 2, text: "added" },
    ]);
    expect(read.diff.get("src/a.ts")?.cut).toBe(false);
    expect(read.diff.get("src/b.ts")?.cut).toBe(true);
  });

  it("says the file list was cut where HQ read only so many", () => {
    expect(changeReadout(detail({ filesTruncated: true })).filesCut).toBe(true);
    expect(changeReadout(detail()).filesCut).toBe(false);
  });

  it.each([
    ["clean", { kind: "clean" }, "mergeable", []],
    [
      "a conflict, with its files",
      { kind: "conflict", paths: ["src/a.ts"] },
      "conflicting",
      ["src/a.ts"],
    ],
    ["unrelated history: a conflict with no files", { kind: "unrelated" }, "conflicting", []],
    ["nothing main lacks", { kind: "empty" }, "empty", []],
    ["merged already", { kind: "already_merged" }, "empty", []],
    ["nothing pushed", { kind: "no_change" }, "empty", []],
  ] as const)("names how it merges: %s", (_name, mergeability, kind, conflict) => {
    const read = changeReadout(detail({ mergeability }));
    expect(read.mergeability).toBe(kind);
    expect(read.conflict).toEqual(conflict);
  });

  it("carries main's head and its merge base with it, which tell a change behind main", () => {
    const behind = changeReadout(detail({ mergeBase: BASE }));
    expect([behind.mergeBase, behind.mainHead]).toEqual([BASE, MAIN]);
    const unborn = changeReadout(detail({ mergeBase: null, mainHead: null }));
    expect([unborn.mergeBase, unborn.mainHead]).toEqual([undefined, undefined]);
  });

  it("lists its commits newest first, as HQ does", () => {
    const read = changeReadout(
      detail({
        commits: [
          { sha: HEAD, subject: "Refresh it", authorName: "Nova", at: "2026-10-02T10:00:00.000Z" },
          { sha: BASE, subject: "Add it", authorName: "Nova", at: "2026-10-02T09:00:00.000Z" },
        ],
      }),
    );
    expect(read.commits).toEqual([
      { sha: HEAD, subject: "Refresh it", at: "2026-10-02T10:00:00.000Z" },
      { sha: BASE, subject: "Add it", at: "2026-10-02T09:00:00.000Z" },
    ]);
  });
});
