// @vitest-environment happy-dom
import type { SelectedLineRange } from "@pierre/diffs";
import type { GitBlob } from "@t3tools/shared/hqGitBrowse/blob";
import type { GitTreeEntry } from "@t3tools/shared/hqGitBrowse/tree";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { GitBrowseSearch } from "./GitBrowseView";
import { GitDirectoryList } from "./GitDirectoryList";
import { GitFileView } from "./GitFileView";

const held = vi.hoisted(() => ({
  /** What the file view last gave the code view: its options and the lines it marks. */
  file: null as null | {
    readonly options: { readonly onLineSelectionEnd?: (range: SelectedLineRange | null) => void };
    readonly selectedLines: SelectedLineRange | null | undefined;
  },
  reveal: [] as Array<{ readonly path: string | null; readonly line: number | null }>,
  copied: [] as Array<string>,
}));
vi.mock("@pierre/diffs/react", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  File: (props: {
    file: { contents: string };
    options: NonNullable<typeof held.file>["options"];
    selectedLines?: SelectedLineRange | null;
  }) => {
    held.file = { options: props.options, selectedLines: props.selectedLines };
    return <pre data-code="">{props.file.contents}</pre>;
  },
}));
vi.mock("~/components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/files/useFileLineReveal", () => ({
  FILE_LINK_REVEAL_UNSAFE_CSS: "",
  useFileLineReveal: (path: string | null, line: number | null) => {
    held.reveal.push({ path, line });
    return () => undefined;
  },
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  writeTextToClipboard: async (value: string) => {
    held.copied.push(value);
    return true;
  },
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: () => undefined } }));
vi.mock("~/zerops/useGitRaw", () => ({
  useGitRaw: () => ({
    view: { state: "unread", busy: false },
    again: () => undefined,
    url: null,
    type: null,
  }),
}));

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

const sha = "a".repeat(40);
const blob = (patch: Partial<GitBlob> = {}): GitBlob => ({
  path: "src/a.ts",
  blobSha: "b".repeat(40),
  size: 120,
  binary: false,
  content: Array.from({ length: 40 }, (_, line) => `const line${line + 1} = ${line + 1};`).join(
    "\n",
  ),
  truncated: false,
  ...patch,
});
const hrefOf = (search: GitBrowseSearch) =>
  `/mate/git?${new URLSearchParams({ appId: "app", repo: "appdev", ...search })}`;

let root: Root;
let host: HTMLDivElement;
const navigate = vi.fn();
beforeEach(() => {
  held.file = null;
  held.reveal = [];
  held.copied = [];
  navigate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function view(file: GitBlob, search: GitBrowseSearch) {
  await act(async () =>
    root.render(
      <GitFileView
        appId="app"
        repo="appdev"
        sha={sha}
        blob={file}
        search={search}
        navigate={navigate}
        hrefOf={hrefOf}
        hasView={(page) => page === "commits"}
      />,
    ),
  );
}
async function press(words: string) {
  const node = [...host.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.textContent === words,
  );
  expect(node, words).toBeDefined();
  await act(async () => node!.click());
}

describe("file view", () => {
  it("A line link opens the file scrolled to that line with the line marked", async () => {
    await view(blob(), { rev: "main", view: "code", path: "src/a.ts", kind: "file", lines: "L12" });
    expect(held.reveal.at(-1)).toEqual({ path: "src/a.ts", line: 12 });
    expect(held.file?.selectedLines).toEqual({ start: 12, end: 12 });
    expect(host.textContent).toContain("40 lines · 120 bytes");
    await view(blob({ content: "one\n", size: 4 }), { path: "src/a.ts", kind: "file" });
    expect(host.textContent).toContain("1 line · 4 bytes");
    // A range reveals its first line and marks every line of it.
    await act(async () => root.unmount());
    root = createRoot(host);
    await view(blob(), { path: "src/a.ts", kind: "file", lines: "L30-L20" });
    expect(held.reveal.at(-1)).toEqual({ path: "src/a.ts", line: 20 });
    expect(held.file?.selectedLines).toEqual({ start: 20, end: 30 });
  });

  it("Selecting lines writes a range link pinned to the commit", async () => {
    await view(blob(), { rev: "main", view: "code", path: "src/a.ts", kind: "file" });
    expect(held.file?.selectedLines).toBeNull();
    await act(async () => held.file!.options.onLineSelectionEnd!({ start: 20, end: 14 }));
    expect(navigate).toHaveBeenLastCalledWith({
      rev: sha,
      view: "code",
      path: "src/a.ts",
      kind: "file",
      lines: "L14-L20",
    });
    await act(async () => held.file!.options.onLineSelectionEnd!(null));
    expect(navigate).toHaveBeenLastCalledWith({
      rev: sha,
      view: "code",
      path: "src/a.ts",
      kind: "file",
    });
  });

  it("Copy link pins the branch's current commit", async () => {
    await view(blob(), { rev: "main", view: "code", path: "src/a.ts", kind: "file", lines: "L3" });
    await press("Copy link");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));
    });
    expect(held.copied).toHaveLength(2);
    for (const copied of held.copied) {
      const link = new URL(copied);
      expect(Object.fromEntries(link.searchParams)).toEqual({
        appId: "app",
        repo: "appdev",
        rev: sha,
        view: "code",
        path: "src/a.ts",
        kind: "file",
        lines: "L3",
      });
    }
    await press("Copy path");
    expect(held.copied.at(-1)).toBe("src/a.ts");
  });

  it("History opens the file's commits on the page's branch", async () => {
    await view(blob(), { rev: "main", view: "code", path: "src/a.ts", kind: "file" });
    await press("History");
    expect(navigate).toHaveBeenLastCalledWith({ rev: "main", view: "commits", path: "src/a.ts" });
  });

  it("A markdown file opens rendered and offers its source", async () => {
    await view(blob({ path: "docs/guide.md", content: "# Guide\n\nRead [setup](./setup.md)." }), {
      path: "docs/guide.md",
      kind: "file",
    });
    expect(host.querySelector("h1")?.textContent).toBe("Guide");
    expect(host.querySelector("[data-code]")).toBeNull();
    const link = host.querySelector<HTMLAnchorElement>("a[href]")!;
    expect(new URL(link.href, "https://mate.test").searchParams.get("path")).toBe("docs/setup.md");
    await press("Source");
    expect(host.querySelector("h1")).toBeNull();
    expect(host.querySelector("[data-code]")?.textContent).toBe(
      "# Guide\n\nRead [setup](./setup.md).",
    );
  });

  it.each([
    [blob({ content: null, binary: true, size: 2048 }), "Binary file, 2 KiB.", true],
    [
      blob({ content: "x", truncated: true, size: 600 * 1024 }),
      "Showing the first 256 KiB of 600 KiB. Download it to read the rest.",
      true,
    ],
    [
      blob({ content: "x", truncated: true, size: 3 * 1024 * 1024 }),
      "Showing the first 256 KiB of 3 MiB. Clone the repository to read the rest.",
      false,
    ],
    [
      blob({ content: null, binary: true, size: 5 * 1024 * 1024 }),
      "5 MiB is more than the browser reads. Clone the repository to read it.",
      false,
    ],
  ])(
    "A file the browser cannot show whole says why and how to read it: %#",
    async (file, words, saves) => {
      await view(file, { path: file.path, kind: "file" });
      expect(host.textContent).toContain(words);
      expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Download")).toBe(
        saves,
      );
    },
  );
});

const tree = (entries: Array<GitTreeEntry>, truncated = false) =>
  renderToStaticMarkup(
    <GitDirectoryList
      entries={entries}
      truncated={truncated}
      hrefOf={() => "#"}
      onOpen={() => {}}
    />,
  );
const entry = (path: string, type: GitTreeEntry["type"], size?: number): GitTreeEntry => ({
  name: path,
  path,
  type,
  mode: type === "folder" ? "040000" : type === "symlink" ? "120000" : "100644",
  sha: "c".repeat(40),
  ...(size === undefined ? {} : { size }),
});

describe("repository source view", () => {
  it("shows every tree entry and explicitly says when the listing is incomplete", () => {
    const html = tree(
      [entry("src", "folder"), entry("README.md", "file", 1536), entry("link", "symlink", 4)],
      true,
    );
    expect(html).toContain("src");
    expect(html).toContain("README.md");
    expect(html).toContain("Folder");
    expect(html).toContain("1.5 KiB");
    expect(html).toContain("Symbolic link");
    expect(html).toContain("Only the first");
  });
  it("renders source as escaped text, identifies binary files and names clipped content", async () => {
    await view(blob({ content: "<script>alert(1)</script>", truncated: true, size: 300 * 1024 }), {
      path: "src/a.ts",
      kind: "file",
    });
    expect(host.innerHTML).toContain("&lt;script&gt;");
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("Showing the first 256 KiB of 300 KiB.");
    await view(blob({ content: null, binary: true }), { path: "src/a.ts", kind: "file" });
    expect(host.textContent).toContain("Binary file");
  });
  it("names an earned empty tree", () => {
    expect(tree([])).toContain("No files here");
    expect(tree([], true)).not.toContain("No files here");
  });
});
