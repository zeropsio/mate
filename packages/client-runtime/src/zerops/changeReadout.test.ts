import type { ChangeReview, HqChange } from "@t3tools/shared/hqChanges";
import type { GitCompare } from "@t3tools/shared/hqGitBrowse/compare";
import { describe, expect, it } from "vite-plus/test";

import { changeReadoutOfCompare, changeReadoutOfRecord } from "./changeReadout.ts";

const MAIN = "a".repeat(40);
const BASE = "b".repeat(40);
const HEAD = "c".repeat(40);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

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
  ready: true,
  comments: 0,
};

describe("changeReadoutOfRecord: a change's review as HQ recorded it", () => {
  const review = (over: Partial<ChangeReview> = {}): ChangeReview => ({
    mergeBase: BASE,
    files: [
      { path: "src/a.ts", added: 4, deleted: 1, binary: false },
      { path: "logo.png", added: null, deleted: null, binary: true },
    ],
    filesTruncated: false,
    conflictPaths: [],
    commits: [
      {
        sha: HEAD,
        subject: "Add a /status page",
        authorName: "Nova",
        at: "2026-10-02T09:00:00.000Z",
      },
    ],
    commitsTruncated: false,
    ...over,
  });

  it("Opening a change review reads its files, sizes and verdict from what HQ recorded", () => {
    const read = changeReadoutOfRecord(
      { ...change, mergeability: "conflict", behind: true },
      review({ conflictPaths: ["src/a.ts"] }),
    );
    expect(read).toMatchObject({
      files: [
        { path: "src/a.ts", additions: 4, deletions: 1 },
        { path: "logo.png", additions: 0, deletions: 0 },
      ],
      filesKnown: true,
      filesCut: false,
      diffBase: BASE,
      mergeability: "conflicting",
      conflict: ["src/a.ts"],
      behind: true,
    });
  });

  it("A file's status letter is the one HQ recorded, and none where it recorded none", () => {
    const read = changeReadoutOfRecord(
      change,
      review({
        files: [
          { path: "new.ts", added: 1, deleted: 0, binary: false, status: "A" },
          { path: "gone.ts", added: 0, deleted: 1, binary: false, status: "D" },
          { path: "edit.ts", added: 1, deleted: 1, binary: false, status: "M" },
          { path: "old-hq.ts", added: 1, deleted: 1, binary: false },
        ],
      }),
    );
    expect(read.files.map(({ status }) => status)).toEqual([
      "added",
      "deleted",
      "modified",
      "unknown",
    ]);
  });

  it("Opening a change review shows the commits HQ recorded at its head", () => {
    const read = changeReadoutOfRecord(change, review({ commitsTruncated: true }));
    expect(read).toMatchObject({
      commits: [{ sha: HEAD, subject: "Add a /status page" }],
      commitsKnown: true,
      commitsCut: true,
    });
  });

  it("A change whose commits are not recorded reads commits not known yet", () => {
    expect(changeReadoutOfRecord(change, review({ commits: null }))).toMatchObject({
      commits: [],
      commitsKnown: false,
    });
  });

  it("says the file list was cut where HQ read only so many", () => {
    expect(changeReadoutOfRecord(change, review({ filesTruncated: true })).filesCut).toBe(true);
    expect(changeReadoutOfRecord(change, review()).filesCut).toBe(false);
  });

  it("lists its commits newest first, as HQ does", () => {
    const read = changeReadoutOfRecord(
      change,
      review({
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

  it("A change whose files are not recorded reads files not known yet", () => {
    const read = changeReadoutOfRecord(change, review({ files: null }));
    expect(read).toMatchObject({ files: [], filesKnown: false });
  });
  it.each([
    ["its recorded merge base", review(), BASE],
    ["Git's empty tree into a main with no commit yet", review({ mergeBase: null }), EMPTY_TREE],
    ["nothing while its files are not recorded", review({ mergeBase: null, files: null }), null],
  ])("A file's diff is read from %s", (_case, recorded, base) => {
    expect(changeReadoutOfRecord(change, recorded).diffBase).toBe(base);
  });
});

describe("changeReadoutOfCompare: files HQ never recorded, read on the person's press", () => {
  const compare = (over: Partial<GitCompare> = {}): GitCompare => ({
    base: { sha: MAIN, ref: { name: "main", kind: "branch" } },
    head: { sha: HEAD, ref: { name: HEAD, kind: "commit" } },
    mergeBase: BASE,
    commits: [],
    totalCommits: 1,
    files: [
      {
        path: "src/a.ts",
        status: "added",
        additions: 4,
        deletions: 0,
        binary: false,
        hunks: "diff --git a/src/a.ts b/src/a.ts",
        loadable: false,
      },
    ],
    totalFiles: 1,
    filesTruncated: false,
    ...over,
  });
  const unrecorded = changeReadoutOfRecord(change, {
    mergeBase: null,
    files: null,
    filesTruncated: false,
    conflictPaths: [],
    commits: null,
    commitsTruncated: false,
  });

  it("Showing the files of a change HQ never recorded lists them from main compared with its head, each diff read from where they split", () => {
    const read = changeReadoutOfCompare(unrecorded, compare({ filesTruncated: true }));
    expect(read).toMatchObject({
      files: [{ path: "src/a.ts", status: "added", additions: 4, deletions: 0 }],
      filesKnown: true,
      filesCut: true,
      diffBase: BASE,
      // Its commits stay what HQ recorded: the Commits section reads them on its own press.
      commitsKnown: false,
    });
  });
});
