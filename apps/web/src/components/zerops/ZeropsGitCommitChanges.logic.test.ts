import type { ReviewDiffPreviewResult, ReviewDiffPreviewSource } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { commitChangesState } from "./ZeropsGitCommitChanges.logic";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const source = (overrides: Partial<ReviewDiffPreviewSource>): ReviewDiffPreviewSource => ({
  id: "commit",
  kind: "branch-range",
  title: "Commit 0123456",
  baseRef: "f".repeat(40),
  headRef: SHA,
  diff: "diff --git a/menu.txt b/menu.txt\n",
  diffHash: "h",
  truncated: false,
  files: [{ path: "menu.txt", previousPath: null, additions: 1, deletions: 0 }],
  ...overrides,
});

const answer = (sources: ReadonlyArray<ReviewDiffPreviewSource>): ReviewDiffPreviewResult => ({
  cwd: "/var/www/shopdev",
  generatedAt: DateTime.makeUnsafe(0),
  sources,
});

const read = (
  data: ReviewDiffPreviewResult | null,
  more: { readonly error?: string; readonly isPending?: boolean } = {},
) => ({ data, error: more.error ?? null, isPending: more.isPending ?? false });

describe("what a commit's page shows for the read of its changes", () => {
  it.each([
    {
      title: "the changes, while the read is under way, show their loading shape",
      query: read(null, { isPending: true }),
      kind: "loading",
    },
    {
      title: "a commit's own changes are shown",
      query: read(answer([source({})])),
      kind: "changes",
    },
    {
      title: "a short name finds the commit the server named in full",
      query: read(answer([source({})])),
      sha: SHA.slice(0, 7),
      kind: "changes",
    },
    {
      title: "a commit that changed nothing says so",
      query: read(answer([source({ diff: "", files: [] })])),
      kind: "empty",
    },
    {
      title: "a commit the checkout does not hold says so",
      query: read(answer([])),
      kind: "absent",
    },
    {
      title: "a Mate whose server predates commit reads never shows its branch as the commit",
      query: read(
        answer([
          source({ id: "working-tree", kind: "working-tree", headRef: null }),
          source({ id: "branch-range", headRef: "main" }),
        ]),
      ),
      kind: "needs-update",
    },
    {
      title: "a read that failed says so",
      query: read(null, { error: "Connection refused" }),
      kind: "failed",
    },
    {
      title: "a read that failed after an answer keeps the answer",
      query: read(answer([source({})]), { error: "Connection refused" }),
      kind: "changes",
    },
  ])("$title", ({ query, sha, kind }) => {
    expect(commitChangesState(query, sha ?? SHA).kind).toBe(kind);
  });
});
