// @vitest-environment happy-dom
import type { GitCommit, GitCommitFile } from "@t3tools/shared/hqGitBrowse/commit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { GitCommitSummary } from "./GitCommitView";
import { fileNote } from "./GitDiffFiles";

const sha = "c".repeat(40);
const parent = "a".repeat(40);
const file = (path: string, patch: Partial<GitCommitFile> = {}): GitCommitFile => ({
  path,
  status: "modified",
  additions: 1,
  deletions: 1,
  binary: false,
  hunks: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-a\n+b\n`,
  loadable: false,
  ...patch,
});
const commit: GitCommit = {
  sha,
  parents: [parent],
  subject: "Count to three",
  body: "The second line is a number now.",
  messageCut: false,
  authorName: "Ada",
  authoredAt: "2026-10-20T10:00:00Z",
  committerName: "Ada",
  committedAt: "2026-10-20T10:00:00Z",
  files: [
    file("src/a.ts", { additions: 2, deletions: 1 }),
    file("logo.png", { status: "added", additions: 0, deletions: 0, binary: true, hunks: null }),
    file("old.txt", { status: "deleted", additions: 0, deletions: 4 }),
  ],
  totalFiles: 3,
  filesTruncated: false,
};
const render = (shown: GitCommit) =>
  renderToStaticMarkup(
    <GitCommitSummary
      commit={shown}
      hrefOf={(search) => `/git?${new URLSearchParams({ ...search })}`}
      navigate={() => {}}
      onJump={() => {}}
    />,
  );
const text = (html: string) => {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element.textContent ?? "";
};

describe("commit page", () => {
  it("A commit shows its message, author and each changed file with its counts", () => {
    const html = render(commit);
    const shown = text(html);
    expect(shown).toContain("Count to three");
    expect(shown).toContain("The second line is a number now.");
    expect(shown).toContain("Ada");
    expect(shown).toContain("3 files changed");
    expect(shown).toContain("Msrc/a.ts+2 −1");
    expect(shown).toContain("Alogo.pngBinary file");
    expect(shown).toContain("Dold.txt+0 −4");
    // Named by its subject; its id is a short monospace mark beside it, and copied whole.
    expect(shown).toContain(sha.slice(0, 7));
    expect(shown).not.toContain(sha);
    expect(shown).toContain("Copy commit id");
    expect(html).toContain(`href="/git?rev=${parent}&amp;view=commit"`);
    expect(html).toContain(`href="/git?rev=${sha}&amp;view=code"`);
  });

  it("A commit with more files than the page lists says how many it changed", () => {
    expect(text(render({ ...commit, totalFiles: 412, filesTruncated: true }))).toContain(
      "Showing 3 files of 412 changed",
    );
  });

  it("Files past the page's budget load one at a time on request", () => {
    const later = file("big.ts", { hunks: null, loadable: true });
    expect(fileNote(later, undefined)).toEqual({
      kind: "load",
      label: "Show the diff",
      busy: false,
    });
    expect(fileNote(later, { state: "unread", busy: true })).toEqual({
      kind: "load",
      label: "Reading the diff…",
      busy: true,
    });
    expect(
      fileNote(later, {
        state: "known",
        answer: { hunks: "@@ -1 +1 @@\n-a\n+b\n" },
        busy: false,
        failed: false,
      }),
    ).toEqual({ kind: "none" });
    expect(
      fileNote(later, { state: "known", answer: { hunks: null }, busy: false, failed: false }),
    ).toEqual({ kind: "words", words: "Too long to read here." });
    expect(fileNote(later, { state: "failed", words: "HQ did not answer." })).toEqual({
      kind: "load",
      label: "Read again",
      busy: false,
    });
    expect(fileNote(file("huge.ts", { hunks: null }), undefined)).toEqual({
      kind: "words",
      words: "Too long to read here.",
    });
    expect(fileNote(file("logo.png", { binary: true, hunks: null }), undefined)).toEqual({
      kind: "words",
      words: "Binary file",
    });
  });
});
