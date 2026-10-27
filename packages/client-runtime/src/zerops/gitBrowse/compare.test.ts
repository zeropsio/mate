import type { GitCompare } from "@t3tools/shared/hqGitBrowse/compare";
import type { GitLogItem } from "@t3tools/shared/hqGitBrowse/log";
import { describe, expect, it } from "vite-plus/test";
import { compareSummary } from "./compare.ts";

const sha = (c: string) => c.repeat(40);
const item = (n: number): GitLogItem => ({
  sha: n.toString(16).padStart(40, "0"),
  parents: [],
  subject: `Count ${n}`,
  authorName: "Ada",
  authoredAt: "2026-10-20T10:00:00Z",
  committedAt: "2026-10-20T10:00:00Z",
});
const compare = (patch: Partial<GitCompare>): GitCompare => ({
  base: { sha: sha("a"), ref: { name: "main", kind: "branch" } },
  head: { sha: sha("b"), ref: { name: "feature", kind: "branch" } },
  mergeBase: sha("a"),
  commits: [item(1)],
  totalCommits: 1,
  files: [],
  totalFiles: 0,
  filesTruncated: false,
  ...patch,
});

describe("compare summary", () => {
  it("Comparing two branches shows what head adds since they split", () => {
    expect(compareSummary(compare({ commits: [item(2), item(1)], totalCommits: 2 }))).toEqual({
      headline: "feature adds 2 commits since it left main",
      nothing: false,
      cut: null,
    });
    expect(compareSummary(compare({})).headline).toBe("feature adds 1 commit since it left main");
  });

  it("More than 100 commits shows the first 100 and the total", () => {
    const commits = Array.from({ length: 100 }, (_, i) => item(250 - i));
    expect(compareSummary(compare({ commits, totalCommits: 250 }))).toEqual({
      headline: "feature adds 250 commits since it left main",
      nothing: false,
      cut: "Showing the newest 100 of 250 commits.",
    });
  });

  it("Comparing a branch with itself says there is nothing to compare", () => {
    const same = compare({
      head: { sha: sha("a"), ref: { name: "main", kind: "branch" } },
      commits: [],
      totalCommits: 0,
    });
    expect(compareSummary(same)).toEqual({
      headline: "There is nothing to compare: main and main are the same commit.",
      nothing: true,
      cut: null,
    });
  });

  it("A branch base already holds says there is nothing to compare", () => {
    expect(compareSummary(compare({ commits: [], totalCommits: 0 }))).toEqual({
      headline: "There is nothing to compare: main already holds every commit of feature.",
      nothing: true,
      cut: null,
    });
  });

  it("Two histories that never met say they share no commit", () => {
    expect(compareSummary(compare({ mergeBase: null, commits: [], totalCommits: 0 }))).toEqual({
      headline: "There is nothing to compare: feature and main share no commit.",
      nothing: true,
      cut: null,
    });
  });

  it("A side named by its commit is named by its short id", () => {
    const byCommit = compare({ head: { sha: sha("c"), ref: { name: sha("c"), kind: "commit" } } });
    expect(compareSummary(byCommit).headline).toBe(
      "Commit ccccccc adds 1 commit since it left main",
    );
  });
});
