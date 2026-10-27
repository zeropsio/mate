/**
 * A repository's history, as HQ compares it: every commit up to `main`'s head, newest first and
 * bounded — read while HQ's repositories are, empty where `main` holds nothing, and the reason
 * where HQ did not answer.
 */
import type { CompareRead } from "@t3tools/client-runtime/zerops";
import type { CompareCommit, RepoListEntry } from "@t3tools/shared/hqChanges";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useRepositoryHistory, type ZeropsHistoryState } from "./useRepositoryHistory";

const HEAD = "a".repeat(40);
const COMMIT: CompareCommit = {
  sha: HEAD,
  subject: "Add a footer",
  authorName: "ada",
  at: "2026-10-02T09:00:00.000Z",
  change: null,
};

/** What HQ answers each comparison asked, and what was asked. */
const compares = vi.hoisted(() => ({
  asked: [] as Array<CompareRead>,
  answer: "answer" as "answer" | "fail" | "none",
}));
vi.mock("./useReleaseComparisons", async () => {
  const { compareReadKey } = await import("@t3tools/client-runtime/zerops");
  return {
    useReleaseComparisons: (asks: ReadonlyMap<string, ReadonlyArray<CompareRead>>) =>
      new Map(
        [...asks].map(([appId, reads]) => {
          compares.asked.push(...reads);
          const key = (read: CompareRead) => compareReadKey(read);
          return [
            appId,
            {
              answers: new Map(
                compares.answer === "answer"
                  ? reads.map((read) => [
                      key(read),
                      {
                        base: null,
                        head: read.query.head,
                        commits: [COMMIT],
                        truncated: true,
                        total: 347,
                      },
                    ])
                  : [],
              ),
              failures: new Map(
                compares.answer === "fail"
                  ? reads.map((read) => [key(read), "HQ is not answering right now."])
                  : [],
              ),
            },
          ];
        }),
      ),
  };
});

const renders: ZeropsHistoryState[] = [];
function Probe(props: Parameters<typeof useRepositoryHistory>[0]) {
  renders.push(useRepositoryHistory(props));
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  renders.length = 0;
  compares.asked = [];
  compares.answer = "answer";
});

function historyOf(
  props: Parameters<typeof useRepositoryHistory>[0],
): ZeropsHistoryState | undefined {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(create(<Probe {...props} />));
  });
  return renders.at(-1);
}

const REPOS: ReadonlyArray<RepoListEntry> = [
  { name: "appdev", mainHead: HEAD, updatedAt: "2026-10-02T09:00:00.000Z" },
  { name: "group", mainHead: null, updatedAt: "2026-10-02T08:00:00.000Z" },
];

describe("useRepositoryHistory", () => {
  it("is every commit up to main's head as HQ compares it, and how many HQ counted", () => {
    expect(historyOf({ appId: "a-todo", repo: "appdev", repos: REPOS })).toEqual({
      kind: "read",
      commits: [COMMIT],
      total: 347,
    });
    expect(compares.asked).toEqual([{ repository: "appdev", query: { head: HEAD }, services: [] }]);
  });

  it("is being read while HQ's repositories are, and while HQ compares", () => {
    expect(historyOf({ appId: "a-todo", repo: "appdev", repos: undefined })).toEqual({
      kind: "reading",
    });
    compares.answer = "none";
    expect(historyOf({ appId: "a-todo", repo: "appdev", repos: REPOS })).toEqual({
      kind: "reading",
    });
  });

  it("is empty where main holds nothing yet, and HQ is asked nothing", () => {
    expect(historyOf({ appId: "a-todo", repo: "group", repos: REPOS })).toEqual({
      kind: "read",
      commits: [],
      total: 0,
    });
    expect(compares.asked).toEqual([]);
  });

  it("says why where HQ did not compare it", () => {
    compares.answer = "fail";
    expect(historyOf({ appId: "a-todo", repo: "appdev", repos: REPOS })).toEqual({
      kind: "failed",
      reason: "HQ is not answering right now.",
      again: expect.any(Function),
    });
  });
});
