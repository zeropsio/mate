import { describe, expect, it } from "vite-plus/test";
import { finderMatches } from "./GitFileFinder.logic";

const paths = [
  "README.md",
  "docs/menus-old/notes.md",
  "src/deep/menu.txt",
  "src/menu/index.ts",
  "src/tea.ts",
  "test/manual.spec.ts",
];

describe("Git file finder", () => {
  it("The file finder matches a typed name against every path at the commit", () => {
    const names = (query: string, limit = 10) =>
      finderMatches(paths, query, limit).rows.map((row) => row.path);
    // A file named so comes first, then one in a folder named so; a path that lacks it is gone.
    expect(names("menu")).toEqual([
      "src/deep/menu.txt",
      "src/menu/index.ts",
      "docs/menus-old/notes.md",
    ]);
    expect(names("deep/menu")).toEqual(["src/deep/menu.txt"]);
    // Letters in order, as typed: `mnl` is manual's name, and lies along a folder's path after it.
    expect(names("mnl")).toEqual(["test/manual.spec.ts", "docs/menus-old/notes.md"]);
    expect(names("@./tea.ts")).toEqual(["src/tea.ts", "test/manual.spec.ts"]);
    expect(names("zzz")).toEqual([]);
    // Nothing typed lists HQ's order; a limit keeps the best and says more match.
    expect(finderMatches(paths, "", 2)).toMatchObject({
      rows: [{ path: "README.md" }, { path: "docs/menus-old/notes.md" }],
      more: true,
    });
    expect(finderMatches(paths, "menu", 1)).toMatchObject({
      rows: [{ path: "src/deep/menu.txt", name: "menu.txt", nameMatchIndices: [0, 1, 2, 3] }],
      more: true,
    });
    expect(finderMatches(paths, "menu", 3).more).toBe(false);
  });
});
