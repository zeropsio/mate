// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { GitBrowseView } from "@t3tools/client-runtime/data";
import type { GitOverviewRepository } from "@t3tools/client-runtime/zerops";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { GitLog, GitLogItem, GitLogQuery } from "@t3tools/shared/hqGitBrowse/log";
import type { GitBrowseSearch } from "./GitBrowseView";
import { GitCommitsView } from "./GitCommitsView";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const held = vi.hoisted(() => ({
  pages: new Map<string, unknown>(),
  asked: [] as Array<unknown>,
}));
vi.mock("~/zerops/useGitBrowse", () => ({
  useGitBrowseReads: (requests: ReadonlyArray<{ readonly params: GitLogQuery }>) => {
    held.asked.push(requests.map((request) => request.params));
    return {
      views: requests.map(
        (request) =>
          held.pages.get(request.params.cursor ?? "") ?? { state: "unread", busy: false },
      ),
      again: () => undefined,
    };
  },
}));
// A list that draws every row: the page's rows, not the virtualizer's window, are under test.
vi.mock("@legendapp/list/react", () => ({
  LegendList: (props: {
    readonly data: ReadonlyArray<{ readonly key: string }>;
    readonly keyExtractor: (row: { readonly key: string }) => string;
    readonly renderItem: (args: { readonly item: { readonly key: string } }) => ReactNode;
    readonly ListFooterComponent?: ReactNode;
  }) => (
    <div>
      {props.data.map((row) => (
        <div key={props.keyExtractor(row)}>{props.renderItem({ item: row })}</div>
      ))}
      {props.ListFooterComponent}
    </div>
  ),
}));

const tip = "a".repeat(40);
const commit = (n: number, extra: Partial<GitLogItem> = {}): GitLogItem => ({
  sha: n.toString(16).padStart(40, "0"),
  parents: [],
  subject: `Commit ${n}`,
  authorName: "Vera",
  authoredAt: "2026-10-20T10:00:00.000Z",
  committedAt: "2026-10-20T10:00:00.000Z",
  ...extra,
});
const known = (answer: GitLog): GitBrowseView<GitLog> => ({
  state: "known",
  answer,
  busy: false,
  failed: false,
});
const home: GitBrowseView<GitHome> = {
  state: "known",
  busy: false,
  failed: false,
  answer: {
    sha: tip,
    ref: { name: "main", kind: "branch" },
    about: {
      remote: null,
      mirror: null,
      updatedAt: "2026-10-21T00:00:00.000Z",
      branchCount: 1,
      tagCount: 0,
    },
    readme: null,
  },
};

async function history(
  search: GitBrowseSearch,
  more: {
    readonly repository?: GitOverviewRepository;
    readonly onOpenChange?: (number: number) => void;
    readonly navigate?: (search: GitBrowseSearch) => void;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <GitCommitsView
        appId="app"
        repo="appdev"
        project="Shop"
        search={search}
        home={home}
        onHomeAgain={() => {}}
        repository={more.repository}
        onOpenChange={more.onOpenChange}
        navigate={more.navigate ?? (() => {})}
        hrefOf={(to) => `/git?${new URLSearchParams({ appId: "app", repo: "appdev", ...to })}`}
        hasView={() => true}
      />,
    ),
  );
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
const link = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("a")].find((a) => a.textContent === text);

describe("history page", () => {
  it("A commit a change merged links to that change by its title", async () => {
    held.asked.length = 0;
    held.pages = new Map([
      [
        "",
        known({
          items: [commit(2, { change: { mateId: "vera", number: 4 } }), commit(1)],
          next: null,
          addsPath: false,
          stopped: false,
        }),
      ],
    ]);
    const opened: number[] = [];
    const repository = {
      name: "appdev",
      coverage: "complete",
      open: false,
      changes: [{ pull: { number: 4, title: "Add the cart", mateProjectId: "vera" } }],
    } as unknown as GitOverviewRepository;
    const { host, close } = await history(
      { view: "commits" },
      { repository, onOpenChange: (number) => opened.push(number) },
    );
    const change = link(host, "Add the cart");
    expect(change?.getAttribute("href")).toMatch(/\/change\/app\/appdev\/4$/u);
    await act(async () => change!.click());
    expect(opened).toEqual([4]);
    // The commit beside it is named by its subject, its id a 7-character link to it.
    expect(host.textContent).toContain("Commit 2");
    const id = commit(2).sha.slice(0, 7);
    expect(new URLSearchParams(link(host, id)!.getAttribute("href")!.split("?")[1])).toEqual(
      new URLSearchParams({ appId: "app", repo: "appdev", rev: commit(2).sha, view: "commit" }),
    );
    expect(link(host, "Browse files")?.getAttribute("href")).toContain(`rev=${commit(2).sha}`);
    await close();
  });

  it("Show more reads the next page of the list the first page started at", async () => {
    held.asked.length = 0;
    held.pages = new Map([
      [
        "",
        known({
          items: [commit(3), commit(2)],
          next: `${tip}:2`,
          addsPath: false,
          stopped: false,
        }),
      ],
    ]);
    const { host, close } = await history({ view: "commits" });
    held.pages.set(
      `${tip}:2`,
      known({ items: [commit(1)], next: null, addsPath: false, stopped: false }),
    );
    const more = [...host.querySelectorAll("button")].find((b) => b.textContent === "Show more");
    await act(async () => more!.click());
    expect(held.asked.at(-1)).toEqual([{ sha: tip }, { sha: tip, cursor: `${tip}:2` }]);
    const subjects = [...host.querySelectorAll("p")]
      .map((p) => p.textContent)
      .filter((text) => text?.startsWith("Commit "));
    expect(subjects).toEqual(["Commit 3", "Commit 2", "Commit 1"]);
    expect(host.textContent).not.toContain("Show more");
    await close();
  });

  it("A path's history is read for that path and says a rename is not followed", async () => {
    held.asked.length = 0;
    held.pages = new Map([
      ["", known({ items: [commit(1)], next: null, addsPath: true, stopped: false })],
    ]);
    const { host, close } = await history({ view: "commits", path: "src/cart.ts" });
    expect(held.asked.at(-1)).toEqual([{ sha: tip, path: "src/cart.ts" }]);
    expect(host.textContent).toContain("History of src/cart.ts");
    expect(host.textContent).toContain("History before a rename is not followed.");
    await close();
  });
});
