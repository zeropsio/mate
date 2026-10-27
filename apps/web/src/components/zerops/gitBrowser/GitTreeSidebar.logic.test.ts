import type { GitTree, GitTreeEntry } from "@t3tools/shared/hqGitBrowse/tree";
import { describe, expect, it } from "vite-plus/test";
import { foldersOpenedAt, foldersToAsk, treeShape } from "./GitTreeSidebar.logic";

const entry = (path: string, type: GitTreeEntry["type"]): GitTreeEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  type,
  mode: type === "folder" ? "040000" : "100644",
  sha: "c".repeat(40),
});
const folder = (...entries: Array<GitTreeEntry>): GitTree => ({ entries, truncated: false });

describe("repository folder tree", () => {
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
