import { describe, expect, it } from "vite-plus/test";

import { changeFileParts, parseChangeDiff, type ChangeDiffLine } from "./changeDiff.ts";

/** One line as the table writes it: kind, old number, new number, text. */
type Row = readonly [ChangeDiffLine["kind"], number | null, number | null, string];

function rows(lines: ReadonlyArray<ChangeDiffLine>): ReadonlyArray<Row> {
  return lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text]);
}

const MODIFIED = [
  "diff --git a/src/server/index.ts b/src/server/index.ts",
  "index 3f2a1b0..9c1e2d4 100644",
  "--- a/src/server/index.ts",
  "+++ b/src/server/index.ts",
  '@@ -10,7 +10,8 @@ import { web } from "./routes/web";',
  ' import { health } from "./routes/health";',
  '+import { status } from "./routes/status";',
  " ",
  " const app = new Hono();",
  ' app.route("/health", health);',
  '-app.route("/", web);',
  '+app.route("/status", status);',
  '+app.route("/", web);',
  "",
].join("\n");

describe("parseChangeDiff", () => {
  it("numbers each line on both sides, the hunk's header kept as git wrote it", () => {
    const file = parseChangeDiff(MODIFIED).get("src/server/index.ts");
    expect(file?.hunks).toHaveLength(1);
    expect(file?.hunks[0]?.header).toBe('@@ -10,7 +10,8 @@ import { web } from "./routes/web";');
    expect(rows(file?.hunks[0]?.lines ?? [])).toEqual([
      ["context", 10, 10, 'import { health } from "./routes/health";'],
      ["add", null, 11, 'import { status } from "./routes/status";'],
      ["context", 11, 12, ""],
      ["context", 12, 13, "const app = new Hono();"],
      ["context", 13, 14, 'app.route("/health", health);'],
      ["del", 14, null, 'app.route("/", web);'],
      ["add", null, 15, 'app.route("/status", status);'],
      ["add", null, 16, 'app.route("/", web);'],
    ]);
  });

  it.each([
    [
      "an added file, keyed by its new path",
      [
        "diff --git a/src/routes/status.ts b/src/routes/status.ts",
        "new file mode 100644",
        "index 0000000..1b2c3d4",
        "--- /dev/null",
        "+++ b/src/routes/status.ts",
        "@@ -0,0 +1,2 @@",
        "+export const status = 1;",
        "+export default status;",
      ],
      "src/routes/status.ts",
      { previousPath: undefined, binary: false, lines: 2 },
    ],
    [
      "a deleted file, keyed by the path it had",
      [
        "diff --git a/old.txt b/old.txt",
        "deleted file mode 100644",
        "--- a/old.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-gone",
      ],
      "old.txt",
      { previousPath: undefined, binary: false, lines: 1 },
    ],
    [
      "a rename, with the path it had",
      [
        "diff --git a/src/a.ts b/src/b.ts",
        "similarity index 90%",
        "rename from src/a.ts",
        "rename to src/b.ts",
        "--- a/src/a.ts",
        "+++ b/src/b.ts",
        "@@ -1 +1 @@",
        "-a",
        "+b",
      ],
      "src/b.ts",
      { previousPath: "src/a.ts", binary: false, lines: 2 },
    ],
    [
      "a pure rename, no hunks at all",
      ["diff --git a/x.md b/y.md", "similarity index 100%", "rename from x.md", "rename to y.md"],
      "y.md",
      { previousPath: "x.md", binary: false, lines: 0 },
    ],
    [
      "a binary file, which has no lines to show",
      [
        "diff --git a/logo.png b/logo.png",
        "new file mode 100644",
        "index 0000000..e69de29",
        "Binary files /dev/null and b/logo.png differ",
      ],
      "logo.png",
      { previousPath: undefined, binary: true, lines: 0 },
    ],
    [
      "a path git had to quote",
      [
        'diff --git "a/docs/caf\\303\\251 menu.md" "b/docs/caf\\303\\251 menu.md"',
        '--- "a/docs/caf\\303\\251 menu.md"',
        '+++ "b/docs/caf\\303\\251 menu.md"',
        "@@ -1 +1 @@",
        "-espresso",
        "+ristretto",
      ],
      "docs/café menu.md",
      { previousPath: undefined, binary: false, lines: 2 },
    ],
  ])("reads %s", (_name, lines, path, expected) => {
    const file = parseChangeDiff(lines.join("\n")).get(path);
    expect(file).toBeDefined();
    expect({
      previousPath: file?.previousPath,
      binary: file?.binary,
      lines: file?.hunks.flatMap((hunk) => hunk.lines).length,
    }).toEqual(expected);
  });

  it("keeps several files apart, and a file's several hunks in order", () => {
    const text = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " one",
      "-two",
      "+2",
      "@@ -40,2 +40,3 @@ function tail() {",
      " forty",
      "+forty-one",
      " forty-two",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -5 +5 @@",
      "-x",
      "+y",
    ].join("\n");
    const parsed = parseChangeDiff(text);
    expect([...parsed.keys()]).toEqual(["a.ts", "b.ts"]);
    const a = parsed.get("a.ts");
    expect(a?.hunks.map((hunk) => hunk.header)).toEqual([
      "@@ -1,2 +1,2 @@",
      "@@ -40,2 +40,3 @@ function tail() {",
    ]);
    expect(rows(a?.hunks[1]?.lines ?? [])).toEqual([
      ["context", 40, 40, "forty"],
      ["add", null, 41, "forty-one"],
      ["context", 41, 42, "forty-two"],
    ]);
  });

  it("drops git's no-newline marker rather than drawing it as a line of code", () => {
    const text = [
      "diff --git a/.nvmrc b/.nvmrc",
      "--- a/.nvmrc",
      "+++ b/.nvmrc",
      "@@ -1 +1 @@",
      "-20",
      "\\ No newline at end of file",
      "+22",
      "\\ No newline at end of file",
    ].join("\n");
    expect(rows(parseChangeDiff(text).get(".nvmrc")?.hunks[0]?.lines ?? [])).toEqual([
      ["del", 1, null, "20"],
      ["add", null, 1, "22"],
    ]);
  });

  it.each([
    ["nothing", ""],
    ["prose, not a diff", "This pull request has no diff."],
  ])("reads %s as no files", (_name, text) => {
    expect(parseChangeDiff(text).size).toBe(0);
  });
});

describe("parseChangeDiff: a diff read only so far (it was too long to read whole)", () => {
  const TWO_FILES = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,2 +1,2 @@",
    " one",
    "-two",
    "+2",
    "diff --git a/b.ts b/b.ts",
    "--- a/b.ts",
    "+++ b/b.ts",
    "@@ -1,3 +1,3 @@",
    "-x",
    "+y",
    "+a line the read stopped insi",
  ].join("\n");

  it.each<
    [string, string, boolean, Record<string, { readonly cut: boolean; readonly lines: number }>]
  >([
    [
      "the file it stopped in says so, and the line it stopped inside goes",
      TWO_FILES,
      true,
      { "a.ts": { cut: false, lines: 3 }, "b.ts": { cut: true, lines: 2 } },
    ],
    [
      "a diff read whole cuts nothing",
      TWO_FILES,
      false,
      { "a.ts": { cut: false, lines: 3 }, "b.ts": { cut: false, lines: 3 } },
    ],
    [
      "a read that stopped inside the first header holds no file",
      "diff --git a/a.ts b/a.",
      true,
      {},
    ],
  ])("%s", (_case, text, cut, expected) => {
    const parsed = parseChangeDiff(text, { cut });
    expect(
      Object.fromEntries(
        [...parsed.values()].map((file) => [
          file.path,
          { cut: file.cut, lines: file.hunks.flatMap((hunk) => hunk.lines).length },
        ]),
      ),
    ).toEqual(expected);
  });
});

describe("changeFileParts", () => {
  it.each([
    ["src/server/routes/status.ts", { dir: "src/server/routes/", name: "status.ts" }],
    [".nvmrc", { dir: "", name: ".nvmrc" }],
    ["a/b", { dir: "a/", name: "b" }],
  ])("splits %s where a row dims the folder", (path, parts) => {
    expect(changeFileParts(path)).toEqual(parts);
  });
});
