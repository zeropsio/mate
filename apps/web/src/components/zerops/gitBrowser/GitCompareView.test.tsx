// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { GitBrowseView } from "@t3tools/client-runtime/data";
import type { GitCommitFile } from "@t3tools/shared/hqGitBrowse/commit";
import type { GitCompare, GitCompareQuery } from "@t3tools/shared/hqGitBrowse/compare";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { GitLogItem } from "@t3tools/shared/hqGitBrowse/log";
import type { GitBrowseSearch } from "./GitBrowseView";
import { GitCompareView } from "./GitCompareView";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const held = vi.hoisted(() => ({
  compare: null as unknown,
  asked: [] as Array<unknown>,
}));
vi.mock("~/zerops/useGitBrowse", () => ({
  useGitBrowse: (request: { readonly params: GitCompareQuery }) => {
    held.asked.push(request.params);
    return { view: held.compare ?? { state: "unread", busy: false }, again: () => undefined };
  },
  useGitBrowseReads: () => ({ views: [], again: () => undefined }),
}));
// The diff viewer draws only what stands above its files: the page's summary is under test.
vi.mock("./GitDiffFiles", async (actual) => ({
  ...(await actual<typeof import("./GitDiffFiles")>()),
  GitDiffFiles: (props: { readonly renderHeader: (jump: () => void) => ReactNode }) => (
    <div>{props.renderHeader(() => undefined)}</div>
  ),
}));
vi.mock("./GitRefPicker", () => ({
  GitRefPicker: (props: { readonly title: string; readonly label: string }) => (
    <button type="button" aria-label={props.title}>
      {props.label}
    </button>
  ),
}));

const sha = (c: string) => c.repeat(40);
const item = (n: number): GitLogItem => ({
  sha: n.toString(16).padStart(40, "0"),
  parents: [],
  subject: `Count ${n}`,
  authorName: "Ada",
  authoredAt: "2026-10-20T10:00:00Z",
  committedAt: "2026-10-20T10:00:00Z",
});
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
const compare = (patch: Partial<GitCompare>): GitCompare => ({
  base: { sha: sha("a"), ref: { name: "main", kind: "branch" } },
  head: { sha: sha("b"), ref: { name: "feature", kind: "branch" } },
  mergeBase: sha("a"),
  commits: [item(2), item(1)],
  totalCommits: 2,
  files: [file("src/a.ts", { additions: 2 }), file("c.txt", { status: "added", deletions: 0 })],
  totalFiles: 2,
  filesTruncated: false,
  ...patch,
});
const home: GitBrowseView<GitHome> = { state: "unread", busy: false };
const source = {
  source: { state: "unread", words: "Waiting for HQ…", alert: false, busy: false },
  again: () => {},
} as const;

const render = (shown: GitCompare, search: GitBrowseSearch) => {
  held.compare = { state: "known", answer: shown, busy: false, failed: false };
  held.asked = [];
  const navigated: Array<GitBrowseSearch> = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <GitCompareView
        appId="app"
        repo="group"
        project="Shop"
        search={search}
        home={home}
        onHomeAgain={() => undefined}
        source={source}
        navigate={(next) => navigated.push(next)}
        hrefOf={(next) => `/git?${new URLSearchParams({ ...next })}`}
      />,
    ),
  );
  return {
    text: container.textContent ?? "",
    container,
    navigated,
    close: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe("compare page", () => {
  it("Comparing two branches shows what head adds since they split", () => {
    const page = render(compare({}), { view: "compare", base: "main", head: "feature" });
    expect(held.asked).toContainEqual({ base: "main", head: "feature" });
    expect(page.text).toContain("feature adds 2 commits since it left main");
    expect(page.text.indexOf("Count 2")).toBeLessThan(page.text.indexOf("Count 1"));
    expect(page.text).toContain("2 files changed");
    expect(page.text).toContain("Msrc/a.ts+2 −1");
    expect(page.text).toContain("Ac.txt+1 −0");
    const link = page.container.querySelector(`a[href*="${item(2).sha}"]`);
    expect(link?.getAttribute("href")).toBe(`/git?rev=${item(2).sha}&view=commit`);
    page.close();
  });

  it("A compare opens from a page's branch against main, and Swap turns it round", () => {
    const page = render(compare({}), { view: "compare", rev: "feature" });
    expect(held.asked).toContainEqual({ base: "main", head: "feature" });
    const swap = [...page.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Swap",
    );
    act(() => swap?.click());
    expect(page.navigated).toEqual([
      { rev: "feature", view: "compare", base: "feature", head: "main" },
    ]);
    page.close();
  });

  it("More than 100 commits shows the first 100 and the total", () => {
    const commits = Array.from({ length: 100 }, (_, i) => item(250 - i));
    const page = render(compare({ commits, totalCommits: 250 }), { view: "compare" });
    expect(page.text).toContain("feature adds 250 commits since it left main");
    expect(page.text).toContain("Showing the newest 100 of 250 commits.");
    expect(page.container.querySelectorAll(`a[href*="view=commit"]`)).toHaveLength(100);
    page.close();
  });

  it("Comparing a branch with itself says there is nothing to compare", () => {
    const same = compare({
      head: { sha: sha("a"), ref: { name: "main", kind: "branch" } },
      commits: [],
      totalCommits: 0,
      files: [],
      totalFiles: 0,
    });
    const page = render(same, { view: "compare", base: "main", head: "main" });
    expect(page.text).toContain("There is nothing to compare: main and main are the same commit.");
    expect(page.text).not.toContain("changed");
    page.close();
  });
});
