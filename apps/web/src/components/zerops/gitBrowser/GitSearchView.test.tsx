// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { GitBrowseView } from "@t3tools/client-runtime/data";
import type { GitGrep } from "@t3tools/shared/hqGitBrowse/grep";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import type { GitPaths } from "@t3tools/shared/hqGitBrowse/paths";
import { GitBrowseView as GitBrowsePage, type GitBrowseSearch } from "./GitBrowseView";
import { GitSearchView } from "./GitSearchView";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const sha = "c".repeat(40);
const held = vi.hoisted(() => ({
  views: {} as Record<string, unknown>,
  asked: [] as Array<{ read: string; params: unknown; allowed: unknown }>,
  again: [] as Array<string>,
}));
vi.mock("~/zerops/useGitBrowse", async () => {
  // A read's identity encodes its query as the real hook does, so a query HQ refuses throws here too.
  const { gitBrowseSearch } = await import("@t3tools/client-runtime/zerops/gitBrowse/reads");
  return {
    useGitBrowse: (request: { read: "grep"; params: never }, allowed: unknown) => {
      gitBrowseSearch(request.read, request.params);
      held.asked.push({ read: request.read, params: request.params, allowed });
      return {
        view: held.views[request.read] ?? { state: "unread", busy: false },
        again: () => held.again.push(request.read),
      };
    },
    useGitBrowseReads: () => ({ views: [], again: () => undefined }),
  };
});

const home: GitBrowseView<GitHome> = {
  state: "known",
  busy: false,
  failed: false,
  answer: {
    sha,
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
const known = <V,>(answer: V): GitBrowseView<V> => ({
  state: "known",
  answer,
  busy: false,
  failed: false,
});
const grep = (answer: GitGrep) => known(answer);

let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unmount?.();
  unmount = null;
  held.views = {};
  held.asked = [];
  held.again = [];
});

async function page(search: GitBrowseSearch, navigate = vi.fn<(to: GitBrowseSearch) => void>()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props: ComponentProps<typeof GitSearchView> = {
    appId: "app",
    repo: "shop",
    project: "Shop",
    search,
    home,
    onHomeAgain: () => {},
    navigate,
    hrefOf: (to) => `/git?${new URLSearchParams({ appId: "app", repo: "shop", ...to })}`,
    hasView: () => true,
  };
  await act(async () => root.render(<GitSearchView {...props} />));
  unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { host, navigate };
}
const text = (host: HTMLElement) => host.textContent ?? "";
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label);

describe("Git browser search page", () => {
  it("Content results stand under their file, and a line opens its file at that line of the commit", async () => {
    held.views["grep"] = grep({
      matches: [
        { path: "src/tea.ts", line: 3, text: "const tea = 1;", ranges: [{ start: 6, end: 9 }] },
        { path: "src/tea.ts", line: 9, text: "tea();", ranges: [{ start: 0, end: 3 }] },
        { path: "README.md", line: 1, text: "Tea shop", ranges: [{ start: 0, end: 3 }] },
      ],
      truncated: false,
      deadlineHit: false,
    });
    const { host, navigate } = await page({ view: "search", scope: "content", q: "tea" });
    // The search reads the commit the page's branch names, not the branch.
    expect(held.asked.find((ask) => ask.read === "grep")).toEqual({
      read: "grep",
      params: { sha, q: "tea" },
      allowed: true,
    });
    expect(text(host)).toContain("3 matching lines in 2 files");
    const sections = [...host.querySelectorAll("section")].map((section) => ({
      file: section.getAttribute("aria-label"),
      lines: [...section.querySelectorAll("a")].slice(1).map((a) => a.textContent),
    }));
    expect(sections).toEqual([
      { file: "src/tea.ts", lines: ["3const tea = 1;", "9tea();"] },
      { file: "README.md", lines: ["1Tea shop"] },
    ]);
    const line = [...host.querySelectorAll("a")].find((a) => a.textContent === "9tea();")!;
    expect(line.getAttribute("href")).toContain(`rev=${sha}`);
    await act(async () => line.click());
    expect(navigate).toHaveBeenCalledWith({
      rev: sha,
      view: "code",
      path: "src/tea.ts",
      kind: "file",
      lines: "L9",
    });
  });

  it("A search cut at its deadline shows what it found, says it stopped and offers Read again", async () => {
    held.views["grep"] = grep({
      matches: [{ path: "a.ts", line: 1, text: "tea", ranges: [{ start: 0, end: 3 }] }],
      truncated: false,
      deadlineHit: true,
    });
    const { host } = await page({ view: "search", scope: "content", q: "tea" });
    expect(text(host)).toContain("1 matching line in 1 file");
    expect(text(host)).toContain("The search stopped after 10 seconds. Narrow it to a folder.");
    await act(async () => button(host, "Read again")!.click());
    expect(held.again).toEqual(["grep"]);
  });

  it("A search cut at 500 matches says to narrow it, showing the first 100 lines until Show more", async () => {
    held.views["grep"] = grep({
      matches: Array.from({ length: 500 }, (_, n) => ({
        path: `f${Math.floor(n / 20)}.ts`,
        line: (n % 20) + 1,
        text: "tea",
        ranges: [{ start: 0, end: 3 }],
      })),
      truncated: true,
      deadlineHit: false,
    });
    const { host } = await page({ view: "search", scope: "content", q: "tea" });
    expect(text(host)).toContain("The search stops at 500 matches. Narrow the search.");
    const lines = () =>
      host.querySelectorAll("section a").length - host.querySelectorAll("section").length;
    expect(lines()).toBe(100);
    await act(async () => button(host, "Show more")!.click());
    expect(lines()).toBe(200);
  });

  it("A search HQ is too busy for says so and offers Read again", async () => {
    held.views["grep"] = {
      state: "failed",
      words: "HQ is busy with other searches. Read again in a moment.",
    };
    const { host } = await page({ view: "search", scope: "content", q: "tea" });
    expect(text(host)).toContain("HQ is busy with other searches. Read again in a moment.");
    await act(async () => button(host, "Read again")!.click());
    expect(held.again).toEqual(["grep"]);
  });

  it("A regular expression git cannot read is said so; nothing is searched before two characters", async () => {
    held.views["grep"] = { state: "refused", reason: "invalid", words: "HQ refused this." };
    const { host } = await page({ view: "search", scope: "content", q: "tea(", mode: "regex" });
    expect(text(host)).toContain("Git cannot read this regular expression.");
    expect(button(host, "Read again")).toBeUndefined();
    await unmount?.();
    held.asked = [];
    const blank = await page({ view: "search", scope: "content" });
    expect(held.asked.filter((ask) => ask.read === "grep")).toEqual([]);
    expect(text(blank.host)).toContain("Binary files are not searched.");
    await unmount?.();
    const short = await page({ view: "search", scope: "content", q: "t" });
    expect(held.asked.filter((ask) => ask.read === "grep")).toEqual([]);
    expect(text(short.host)).toContain("Type at least 2 characters to search.");
  });

  it.each([
    { path: "/src", mode: "text" },
    { path: "../src", mode: "text" },
    { path: "/src", mode: "regex" },
    { path: "src/../..", mode: "regex" },
  ] as const)(
    "A folder outside the repository ($path, searched as $mode) is said so and never searched",
    async ({ path, mode }) => {
      const { host } = await page({
        view: "search",
        scope: "content",
        q: "tea",
        path,
        ...(mode === "regex" ? { mode } : {}),
      });
      expect(held.asked.filter((ask) => ask.read === "grep")).toEqual([]);
      expect(text(host)).toContain(
        "This folder is outside the repository. Name it from the top, like src/app.",
      );
      expect(text(host)).not.toContain("Type at least");
      expect(text(host)).not.toContain("regular expression.");
    },
  );

  it("A folder typed with ./ or a closing slash searches that folder", async () => {
    for (const typed of ["./src/", "src/", " src "]) {
      const { host, navigate } = await page({ view: "search", scope: "content" });
      const input = (label: string) =>
        host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      const type = (label: string, value: string) => {
        const field = input(label);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          field,
          value,
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      };
      await act(async () => {
        type("Text to search for", "tea");
        type("In folder", typed);
      });
      await act(async () => button(host, "Search")!.click());
      expect(navigate, typed).toHaveBeenLastCalledWith({
        view: "search",
        scope: "content",
        q: "tea",
        path: "src",
      });
      await unmount?.();
      unmount = null;
    }
  });

  it("The finder narrows every path at the commit as a name is typed and says when it sees only the first 25,000", async () => {
    const answer: GitPaths = {
      paths: ["README.md", "src/deep/menu.txt", "src/tea.ts"],
      truncated: true,
    };
    held.views["paths"] = known(answer);
    const { host, navigate } = await page({ view: "search" });
    expect(held.asked.find((ask) => ask.read === "paths")?.params).toEqual({ sha });
    expect(text(host)).toContain("The finder sees the first 25,000 files.");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Find a file"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "menu");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const rows = [...host.querySelectorAll('ul[aria-label="Files"] a')];
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      `/git?appId=app&repo=shop&rev=${sha}&view=code&path=src%2Fdeep%2Fmenu.txt&kind=file`,
    ]);
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(navigate).toHaveBeenCalledWith({
      rev: sha,
      view: "code",
      path: "src/deep/menu.txt",
      kind: "file",
    });
  });

  it("t opens the file finder from any page of the repository", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const navigate = vi.fn<(to: GitBrowseSearch) => void>();
    await act(async () =>
      root.render(
        <GitBrowsePage
          view="home"
          appId="app"
          repo="shop"
          project="Shop"
          search={{ rev: "v1" }}
          home={home}
          onHomeAgain={() => {}}
          navigate={navigate}
          hrefOf={() => "/git"}
        />,
      ),
    );
    unmount = async () => {
      await act(async () => root.unmount());
      host.remove();
    };
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true })),
    );
    expect(navigate).toHaveBeenCalledWith({ rev: "v1", view: "search", scope: "name" });
  });
});
