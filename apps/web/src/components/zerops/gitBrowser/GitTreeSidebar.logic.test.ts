import type { GitTree, GitTreeEntry } from "@t3tools/shared/hqGitBrowse/tree";
import { describe, expect, it } from "vite-plus/test";
import { FileTree } from "@pierre/trees";
import { foldersOpenedAt, foldersToAsk, syncTree, treeShape } from "./GitTreeSidebar.logic";

const entry = (path: string, type: GitTreeEntry["type"]): GitTreeEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  type,
  mode: type === "folder" ? "040000" : "100644",
  sha: "c".repeat(40),
});
const folder = (...entries: Array<GitTreeEntry>): GitTree => ({ entries, truncated: false });

describe("repository folder tree", () => {
  it.each(["src/app/plain", "src/app/[locale]/(checkout)/checkout/comgate"])(
    "A folder stays closed while its listing reloads and opens again on request: %s",
    (path) => {
      const at = { path: `${path}/page.tsx`, kind: "file" } as const;
      const rows = [
        ...foldersOpenedAt(at)
          .filter(Boolean)
          .map((path) => `${path}/`),
        at.path,
      ];
      const shape = { rows, expanded: rows.filter((row) => row.endsWith("/")), selected: at.path };
      const model = new FileTree({ paths: [], flattenEmptyDirectories: false });
      syncTree(model, shape, at, new Set());
      const parent = model.getItem("src/");
      if (parent === null || !("collapse" in parent)) throw new Error("Missing folder");
      parent.collapse();
      // Descendants retain their expansion even though their parent hides them.
      syncTree(model, { ...shape, rows: [...rows, `${path}/late.ts`] }, at, new Set(["src/"]));
      const reloaded = model.getItem("src/");
      expect(reloaded !== null && "isExpanded" in reloaded && reloaded.isExpanded()).toBe(false);
      if (reloaded !== null && "expand" in reloaded) reloaded.expand();
      const nested = model.getItem(`${path}/`);
      expect(nested !== null && "isExpanded" in nested && nested.isExpanded()).toBe(true);
      expect(model.getItem(`${path}/late.ts`)).not.toBeNull();
      model.cleanUp();
    },
  );

  it("Opening a file keeps its folders open and moves selection and focus to that file", () => {
    const rows = ["src/", "src/a.ts", "src/b.ts"];
    const model = new FileTree({ paths: [], flattenEmptyDirectories: false });
    for (const path of ["src/a.ts", "src/b.ts"]) {
      syncTree(
        model,
        { rows, expanded: ["src/"], selected: path },
        { path, kind: "file" },
        new Set(),
      );
      expect(model.getSelectedPaths()).toEqual([path]);
      expect(model.getFocusedPath()).toBe(path);
      const folder = model.getItem("src/");
      expect(folder !== null && "isExpanded" in folder && folder.isExpanded()).toBe(true);
    }
    model.cleanUp();
  });
  it("A file link reopens its closed ancestors and keeps them open when more rows arrive", () => {
    const model = new FileTree({ paths: [], flattenEmptyDirectories: false });
    const at = { path: "src/a.ts", kind: "file" } as const;
    const shape = { rows: ["src/", at.path], expanded: ["src/"], selected: at.path };
    const collapsed = new Set(["src/"]);
    syncTree(model, shape, at, collapsed);
    syncTree(model, { ...shape, rows: [...shape.rows, "src/b.ts"] }, at, collapsed);
    const folder = model.getItem("src/");
    expect(folder !== null && "isExpanded" in folder && folder.isExpanded()).toBe(true);
    expect(model.getFocusedPath()).toBe(at.path);
    model.cleanUp();
  });
  it("Opening a deep path expands the tree down to it", () => {
    const at = { path: "src/app/ui/Button.tsx", kind: "file" } as const;
    const opened = foldersOpenedAt(at);
    expect(opened).toEqual(["", "src", "src/app", "src/app/ui"]);
    // Every folder on the way down is read; the ones not on it are not.
    expect(foldersToAsk(opened, [], new Set())).toEqual(["", "src", "src/app", "src/app/ui"]);
    const read = new Map([
      ["", folder(entry("src", "folder"), entry("docs", "folder"), entry("README.md", "file"))],
      ["src", folder(entry("src/app", "folder"), entry("src/main.ts", "file"))],
      ["src/app", folder(entry("src/app/ui", "folder"))],
      ["src/app/ui", folder(entry("src/app/ui/Button.tsx", "file"))],
    ]);
    expect(treeShape(opened, read, at)).toEqual({
      rows: [
        "src/",
        "docs/",
        "README.md",
        "src/app/",
        "src/main.ts",
        "src/app/ui/",
        "src/app/ui/Button.tsx",
      ],
      expanded: ["src/", "src/app/", "src/app/ui/"],
      selected: "src/app/ui/Button.tsx",
    });
    // A folder page opens that folder too; the tree selects it once its row is read.
    const tree = { path: "src/app", kind: "tree" } as const;
    expect(foldersOpenedAt(tree)).toEqual(["", "src", "src/app"]);
    expect(foldersOpenedAt({ path: "", kind: "tree" })).toEqual([""]);
    expect(treeShape(["", "src", "src/app"], read, tree)).toMatchObject({
      expanded: ["src/", "src/app/"],
      selected: "src/app/",
    });
    // Before the folders above it are read, nothing is selected that has no row.
    expect(treeShape(opened, new Map([["", read.get("")!]]), at)).toEqual({
      rows: ["src/", "docs/", "README.md"],
      expanded: ["src/"],
      selected: null,
    });
  });

  it.each([
    [["", "a", "b", "c", "d", "e"], [], [], ["", "a", "b", "c"]],
    [
      ["", "a", "b", "c", "d", "e"],
      ["", "a", "b", "c"],
      ["", "b"],
      ["", "a", "b", "c", "d", "e"],
    ],
    [["", "a", "b", "c", "d", "e"], ["", "a", "b", "c"], [], ["", "a", "b", "c"]],
  ])(
    "A tree keeps at most four folder reads in flight: opened %j, asked %j, read %j",
    (opened, asked, read, next) => {
      expect(foldersToAsk(opened, asked, new Set(read))).toEqual(next);
    },
  );
});
