import { expect, it } from "vite-plus/test";

import { parseChangeDiff } from "./changeDiff.ts";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " a",
  "+b",
  " c",
  "@@ -10,3 +11,3 @@ function f() {",
  " keep",
  "-old",
  "+new",
  " tail",
  "\\ No newline at end of file",
  "diff --git a/b.txt b/b.txt",
  "index 3333333..4444444 100644",
  "--- a/b.txt",
  "+++ b/b.txt",
  "@@ -1 +1 @@",
  "-one",
  "\\ No newline at end of file",
  "+uno",
  "\\ No newline at end of file",
  "",
].join("\n");

// witness: packages/client-runtime/src/zerops/changeDiff.ts | oldLine = Number(range[1]); → oldLine = Number(range[2]);
it("ZV132: A change's diff numbers each line on both sides, keeps files and hunks apart and in order, and shows no no-newline marker as a line", () => {
  const files = parseChangeDiff(diff);
  expect([...files.keys()]).toEqual(["src/a.ts", "b.txt"]);
  expect(files.get("src/a.ts")).toEqual({
    path: "src/a.ts",
    previousPath: undefined,
    binary: false,
    hunks: [
      {
        header: "@@ -1,2 +1,3 @@",
        lines: [
          { kind: "context", oldLine: 1, newLine: 1, text: "a" },
          { kind: "add", oldLine: null, newLine: 2, text: "b" },
          { kind: "context", oldLine: 2, newLine: 3, text: "c" },
        ],
      },
      {
        header: "@@ -10,3 +11,3 @@ function f() {",
        lines: [
          { kind: "context", oldLine: 10, newLine: 11, text: "keep" },
          { kind: "del", oldLine: 11, newLine: null, text: "old" },
          { kind: "add", oldLine: null, newLine: 12, text: "new" },
          { kind: "context", oldLine: 12, newLine: 13, text: "tail" },
        ],
      },
    ],
  });
  expect(files.get("b.txt")).toEqual({
    path: "b.txt",
    previousPath: undefined,
    binary: false,
    hunks: [
      {
        header: "@@ -1 +1 @@",
        lines: [
          { kind: "del", oldLine: 1, newLine: null, text: "one" },
          { kind: "add", oldLine: null, newLine: 1, text: "uno" },
        ],
      },
    ],
  });
});
