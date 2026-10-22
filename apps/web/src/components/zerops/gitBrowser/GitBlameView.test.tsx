// @vitest-environment happy-dom
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import type { GitBlame } from "@t3tools/shared/hqGitBrowse/blame";
import type { GitBlob } from "@t3tools/shared/hqGitBrowse/blob";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GitBlameView } from "./GitBlameView";
import type { GitBrowseSearch } from "./GitBrowseView";

const LINE = 20;
const held = vi.hoisted(() => ({
  views: {} as Record<string, unknown>,
  asked: [] as Array<{ readonly read: string; readonly allowed: boolean | undefined }>,
}));
vi.mock("@pierre/diffs", () => ({
  VirtualizedFile: class {
    getLinePosition(line: number) {
      return { top: (line - 1) * 20, height: 20 };
    }
  },
}));
vi.mock("@pierre/diffs/react", async () => {
  // The mocked file above, built without the real one's arguments.
  const VirtualizedFile = (await import("@pierre/diffs"))
    .VirtualizedFile as unknown as new () => object;
  return {
    Virtualizer: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    // The file draws its lines and says so, as pierre's does once it has measured them.
    File: (props: {
      file: { contents: string };
      options: { onPostRender?: (host: HTMLElement, file: unknown, phase: string) => void };
    }) => {
      useEffect(() => {
        props.options.onPostRender?.(document.createElement("div"), new VirtualizedFile(), "mount");
      });
      return <pre data-code="">{props.file.contents}</pre>;
    },
  };
});
vi.mock("~/components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/files/useFileLineReveal", () => ({
  FILE_LINK_REVEAL_UNSAFE_CSS: "",
  useFileLineReveal: () => () => undefined,
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("./GitTreeSidebar", () => ({ GitTreeSidebar: () => null }));
vi.mock("~/zerops/useGitBrowse", () => ({
  useGitBrowse: (request: { read: string }, allowed: boolean | undefined) => {
    held.asked.push({ read: request.read, allowed });
    return {
      view: (allowed ? held.views[request.read] : undefined) ?? { state: "unread", busy: false },
      again: () => undefined,
    };
  },
}));

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

const sha = "c".repeat(40);
const start = "a".repeat(40);
const moved = "b".repeat(40);
const known = <A,>(answer: A): GitBrowseState<A> => ({
  state: "known",
  answer,
  busy: false,
  failed: false,
});
const home = known({ sha } as GitHome);
const blob = (patch: Partial<GitBlob> = {}): GitBlob => ({
  path: "src/b.ts",
  blobSha: "f".repeat(40),
  size: 30,
  binary: false,
  content: "one\n2\nthree\nfour\n",
  truncated: false,
  ...patch,
});
const blame: GitBlame = {
  ranges: [
    { start: 1, count: 1, commit: start },
    { start: 2, count: 1, commit: moved },
    { start: 3, count: 2, commit: start },
  ],
  commits: [
    {
      sha: start,
      subject: "Start the file",
      authorName: "Ada",
      authoredAt: "2025-10-21T00:00:00.000Z",
    },
    {
      sha: moved,
      subject: "Move it and use digits",
      authorName: "Bo",
      authoredAt: "2026-10-21T00:00:00.000Z",
      previous: { sha: start, path: "src/a.ts" },
    },
  ],
};
const hrefOf = (search: GitBrowseSearch) =>
  `/mate/git?${new URLSearchParams({ appId: "app", repo: "appdev", ...search })}`;

let root: Root;
let host: HTMLDivElement;
const navigate = vi.fn();
beforeEach(() => {
  held.views = {};
  held.asked = [];
  navigate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function view(search: GitBrowseSearch = { rev: sha, view: "blame", path: "src/b.ts" }) {
  await act(async () =>
    root.render(
      <GitBlameView
        appId="app"
        repo="appdev"
        project="P"
        search={search}
        home={home}
        onHomeAgain={() => undefined}
        navigate={navigate}
        hrefOf={hrefOf}
        hasView={() => true}
      />,
    ),
  );
}
const rows = () =>
  [...host.querySelectorAll<HTMLElement>("[data-blame-start]")].map((row) => ({
    start: row.dataset.blameStart,
    top: row.style.top,
    height: row.style.height,
    text: row.textContent,
  }));

describe("blame page", () => {
  it("Each line names the commit that last changed it", async () => {
    held.views = { blob: known(blob()), blame: known(blame) };
    await view();
    expect(host.querySelector("[data-code]")?.textContent).toBe("one\n2\nthree\nfour\n");
    expect(rows()).toEqual([
      {
        start: "1",
        top: "0px",
        height: `${LINE}px`,
        text: expect.stringMatching(/Start the file.*Ada/u),
      },
      {
        start: "2",
        top: `${LINE}px`,
        height: `${LINE}px`,
        text: expect.stringMatching(/Move it and use digits.*Bo/u),
      },
      {
        start: "3",
        top: `${2 * LINE}px`,
        height: `${2 * LINE}px`,
        text: expect.stringMatching(/Start the file.*Ada/u),
      },
    ]);
    // A subject opens its commit.
    const subject = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent === "Move it and use digits",
    )!;
    expect(new URL(subject.href, "https://mate.test").searchParams.get("rev")).toBe(moved);
    expect(new URL(subject.href, "https://mate.test").searchParams.get("view")).toBe("commit");
  });

  it("Blame before a commit shows the file as its parent had it", async () => {
    held.views = { blob: known(blob()), blame: known(blame) };
    await view();
    const before = [...host.querySelectorAll<HTMLAnchorElement>("a")].filter(
      (link) => link.querySelector('[aria-label="Blame before this commit"]') !== null,
    );
    // Only the commit with a parent offers it: the file's first commit added it.
    expect(before).toHaveLength(1);
    expect(
      Object.fromEntries(new URL(before[0]!.href, "https://mate.test").searchParams),
    ).toMatchObject({ rev: start, view: "blame", path: "src/a.ts" });
    await act(async () => before[0]!.click());
    expect(navigate).toHaveBeenLastCalledWith({ rev: start, view: "blame", path: "src/a.ts" });
  });

  it("A file over 256 KiB offers no blame and says why", async () => {
    held.views = {
      blob: known(blob({ size: 300 * 1024, truncated: true })),
      blame: known(blame),
    };
    await view();
    expect(host.textContent).toContain(
      "Blame reads files up to 256 KiB. This file is 300 KiB. Clone the repository to blame it.",
    );
    expect(held.asked.filter((ask) => ask.read === "blame" && ask.allowed)).toEqual([]);
    expect(rows()).toEqual([]);
    // A cut file's text counts no lines.
    expect(host.textContent).toContain("300 KiB");
    expect(host.textContent).not.toMatch(/\d+ lines? ·/u);
    held.views = { blob: known(blob({ binary: true, content: null })) };
    await view();
    expect(host.textContent).toContain("Only text files have blame.");
  });

  it("`b` goes back from blame to the file at the same lines", async () => {
    held.views = { blob: known(blob()), blame: known(blame) };
    await view({ rev: sha, view: "blame", path: "src/b.ts", lines: "L2" });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    });
    const file = { rev: sha, view: "code", path: "src/b.ts", kind: "file", lines: "L2" };
    expect(navigate).toHaveBeenLastCalledWith(file);
    navigate.mockReset();
    const pressed = [...host.querySelectorAll("button")].find((b) => b.textContent === "Blame")!;
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    await act(async () => pressed.click());
    expect(navigate).toHaveBeenLastCalledWith(file);
  });
});
