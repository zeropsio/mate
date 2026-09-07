import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CheckpointRef, EnvironmentId, ThreadId, type CheckpointHistory } from "@t3tools/contracts";
import { CheckpointHistoryDiff } from "./CheckpointHistoryDiff";

const query = vi.hoisted(() => vi.fn());
vi.mock("../lib/checkpointDiffState", () => ({ useCheckpointDiff: query }));
vi.mock("./diffs/AnnotatableCodeView", () => ({
  AnnotatableCodeView: () => <div>Available code changes</div>,
}));
const now = "2026-09-07T10:00:00.000Z";
const snapshot = {
  status: "captured" as const,
  oid: "abc",
  ref: CheckpointRef.make("refs/mate/run-1"),
  startedAt: now,
  completedAt: now,
};
const history: CheckpointHistory = {
  runId: "run-1",
  coverage: "partial",
  policyVersion: "git-v1",
  representation: "git-normalized",
  semantics: "observed-workspace",
  roots: [
    {
      root: { rootId: "api", label: "API service", remotePath: "/var/www", pathPrefix: "api/" },
      before: snapshot,
      after: snapshot,
    },
    {
      root: { rootId: "web", label: "Web service", remotePath: "/var/www", pathPrefix: "web/" },
      before: { status: "missing-baseline", reason: "First observed after edits began." },
      after: snapshot,
    },
  ],
};
const props = {
  history,
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
  fromTurnCount: 0,
  toTurnCount: 1,
  ignoreWhitespace: true,
  resolvedTheme: "light" as const,
  diffRenderMode: "stacked" as const,
  wordWrap: false,
  composerDraftTarget: {
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("thread-1"),
  },
  selectedFilePath: null,
  revealRequestId: 0,
};

describe("independent checkpoint root review", () => {
  beforeEach(() => query.mockReset());
  it("keeps one service detail visible and identifies the other missing baseline", () => {
    query.mockReturnValue({
      data: {
        diff: "diff --git a/api/a.txt b/api/a.txt\n--- a/api/a.txt\n+++ b/api/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
        coverage: "complete",
        roots: [{ rootId: "api", label: "API service", pathPrefix: "api/", status: "available" }],
      },
      error: null,
      isPending: false,
      refresh: () => {},
    });
    const html = renderToStaticMarkup(<CheckpointHistoryDiff {...props} />);
    expect(html).toContain("Available code changes");
    expect(html).toContain("Web service");
    expect(html).toContain("First observed after edits began.");
    expect(html).toContain("History is incomplete");
    expect(query.mock.calls[0]?.[0]).toMatchObject({ rootId: "api", cacheScope: "run-1" });
    expect(query.mock.calls[1]?.[1]).toEqual({ enabled: false });
  });
  it("offers a source retry and does not leave a loading message alongside a failure", () => {
    query.mockReturnValue({
      data: null,
      error: "Snapshot objects are absent.",
      isPending: true,
      refresh: () => {},
    });
    const html = renderToStaticMarkup(<CheckpointHistoryDiff {...props} />);
    expect(html).toContain("Snapshot objects are absent.");
    expect(html).toContain("Retry API service diff");
    expect(html).not.toContain("Loading API service");
    expect(html).not.toContain("No changes");
  });
});

it("does not label an older server aggregate patch as one service's changes", () => {
  query.mockReturnValue({
    data: { diff: "aggregate patch" },
    error: null,
    isPending: false,
    refresh: () => {},
  });
  const html = renderToStaticMarkup(<CheckpointHistoryDiff {...props} />);
  expect(html).toContain("did not provide a comparison for the requested service");
  expect(html).not.toContain("aggregate patch");
});
