import { describe, expect, it } from "@effect/vitest";

import type { FileWrite } from "@t3tools/contracts";

import {
  FILE_WRITE_TEXT_MAX_CHARS,
  hasFileWrites,
  lineChanges,
  readFileWritePaths,
  readFileWrites,
} from "./fileWrites.ts";

/** Everything a reader would see of the writes: their paths and the text of each change. */
const seen = (writes: ReadonlyArray<FileWrite>) =>
  writes.flatMap((write) => [write.path, ...write.changes.map((change) => change.text)]).join("\n");

const wrote = (text: string, removedLines = 0) => ({ text, removedLines });

interface Case {
  readonly name: string;
  readonly data: unknown;
  readonly writes: ReadonlyArray<{
    readonly path: string;
    readonly kind: "write" | "edit";
    readonly changes: ReadonlyArray<{ readonly text: string; readonly removedLines: number }>;
  }>;
  /** What the agent only read or found in the file: never sent. */
  readonly never?: ReadonlyArray<string>;
}

const DRIVERS: ReadonlyArray<readonly [driver: string, cases: ReadonlyArray<Case>]> = [
  [
    "Claude Code",
    [
      {
        name: "a write shows its content",
        data: { toolName: "Write", input: { file_path: "/srv/notes.md", content: "a\nb\n" } },
        writes: [{ path: "/srv/notes.md", kind: "write", changes: [wrote("a\nb\n")] }],
      },
      {
        name: "an edit shows only its new text",
        data: {
          toolName: "Edit",
          input: {
            file_path: "/home/u/.npmrc",
            old_string: "registry=old",
            new_string: "registry=new",
          },
        },
        writes: [{ path: "/home/u/.npmrc", kind: "edit", changes: [wrote("registry=new", 1)] }],
        never: ["registry=old"],
      },
      {
        name: "an edit that only removes reads as a count",
        data: {
          toolName: "Edit",
          input: { file_path: "/srv/a.ts", old_string: "x\ny\nz", new_string: "" },
        },
        writes: [{ path: "/srv/a.ts", kind: "edit", changes: [wrote("", 3)] }],
        never: ["x\ny\nz"],
      },
      {
        name: "a multi-edit shows each edit's new text",
        data: {
          toolName: "MultiEdit",
          input: {
            file_path: "/srv/a.ts",
            edits: [
              { old_string: "one", new_string: "uno" },
              { old_string: "two", new_string: "dos" },
            ],
          },
        },
        writes: [{ path: "/srv/a.ts", kind: "edit", changes: [wrote("uno", 1), wrote("dos", 1)] }],
        never: ["one", "two"],
      },
      {
        name: "a notebook edit shows the cell's new source",
        data: {
          toolName: "NotebookEdit",
          input: { notebook_path: "/srv/n.ipynb", new_source: "print(1)", edit_mode: "replace" },
        },
        writes: [{ path: "/srv/n.ipynb", kind: "edit", changes: [wrote("print(1)")] }],
      },
      {
        name: "a notebook cell deleted: nothing to show",
        data: {
          toolName: "NotebookEdit",
          input: { notebook_path: "/srv/n.ipynb", new_source: "", edit_mode: "delete" },
        },
        writes: [],
      },
      {
        name: "a read wrote nothing",
        data: { toolName: "Read", input: { file_path: "/srv/a.ts" } },
        writes: [],
      },
      {
        name: "a payload already slimmed for a client keeps no text: nothing to show",
        data: { toolName: "Write", input: { file_path: "/srv/a.ts" } },
        writes: [],
      },
    ],
  ],
  [
    "Codex",
    [
      {
        name: "an added file shows its content; an update only its added lines; a delete nothing",
        data: {
          item: {
            type: "fileChange",
            changes: [
              { path: "/srv/new.ts", kind: { type: "add" }, diff: "export {};\n" },
              {
                path: "/home/u/.env",
                kind: { type: "update", move_path: null },
                diff: [
                  "--- a/.env",
                  "+++ b/.env",
                  "@@ -1,3 +1,3 @@",
                  " API_TOKEN=context-secret",
                  "-PORT=3000",
                  "+PORT=8080",
                  " DEBUG=0",
                  "@@ -9,2 +9,1 @@",
                  " KEEP=1",
                  "-GONE_A=1",
                  "-GONE_B=1",
                  "",
                ].join("\n"),
              },
              { path: "/srv/gone.ts", kind: { type: "delete" }, diff: "deleted-secret\n" },
            ],
          },
        },
        writes: [
          { path: "/srv/new.ts", kind: "write", changes: [wrote("export {};\n")] },
          { path: "/home/u/.env", kind: "edit", changes: [wrote("PORT=8080", 1), wrote("", 2)] },
        ],
        never: ["context-secret", "PORT=3000", "DEBUG=0", "KEEP=1", "GONE_A", "deleted-secret"],
      },
      {
        name: "a moved file is named where it went",
        data: {
          item: {
            type: "fileChange",
            changes: [
              { path: "/a.ts", kind: { type: "update", move_path: "/b.ts" }, diff: "@@\n-x\n+y" },
            ],
          },
        },
        writes: [{ path: "/b.ts", kind: "edit", changes: [wrote("y", 1)] }],
        never: ["x"],
      },
    ],
  ],
  [
    "OpenCode",
    [
      {
        name: "a write shows its content",
        data: { tool: "write", state: { input: { filePath: "/srv/x.txt", content: "hi" } } },
        writes: [{ path: "/srv/x.txt", kind: "write", changes: [wrote("hi")] }],
      },
      {
        name: "an edit shows only its new text",
        data: {
          tool: "edit",
          input: { filePath: "/srv/x.txt", oldString: "old-secret", newString: "hello" },
        },
        writes: [{ path: "/srv/x.txt", kind: "edit", changes: [wrote("hello", 1)] }],
        never: ["old-secret"],
      },
      {
        name: "a multi-edit shows each edit's new text",
        data: {
          tool: "multiedit",
          input: {
            filePath: "/srv/x.txt",
            edits: [{ filePath: "/srv/x.txt", oldString: "a-secret", newString: "b" }],
          },
        },
        writes: [{ path: "/srv/x.txt", kind: "edit", changes: [wrote("b", 1)] }],
        never: ["a-secret"],
      },
      {
        name: "a patch: an added file's content, an update's added lines only",
        data: {
          tool: "apply_patch",
          input: {
            patchText: [
              "*** Begin Patch",
              "*** Add File: /srv/new.md",
              "+# Title",
              "+body",
              "*** Update File: /srv/old.md",
              "@@ context-secret",
              " kept-secret",
              "-was-secret",
              "+is",
              "*** Delete File: /srv/gone.md",
              "*** End Patch",
            ].join("\n"),
          },
        },
        writes: [
          { path: "/srv/new.md", kind: "write", changes: [wrote("# Title\nbody")] },
          { path: "/srv/old.md", kind: "edit", changes: [wrote("is", 1)] },
        ],
        never: ["context-secret", "kept-secret", "was-secret"],
      },
    ],
  ],
  [
    "ACP (Cursor, Grok, Antigravity)",
    [
      {
        name: "a new file shows its content",
        data: {
          kind: "edit",
          content: [{ type: "diff", path: "/srv/n.txt", oldText: null, newText: "new" }],
        },
        writes: [{ path: "/srv/n.txt", kind: "write", changes: [wrote("new")] }],
      },
      {
        name: "a whole-file diff shows only the lines it added, never the old file",
        data: {
          kind: "edit",
          content: [
            { type: "content", content: { type: "text", text: "Edited." } },
            {
              type: "diff",
              path: "/home/u/.docker/config.json",
              oldText: '{\n  "auth": "old-secret",\n  "port": 1\n}',
              newText: '{\n  "auth": "old-secret",\n  "port": 2\n}',
            },
          ],
        },
        writes: [
          { path: "/home/u/.docker/config.json", kind: "edit", changes: [wrote('  "port": 2', 1)] },
        ],
        never: ["old-secret", '"port": 1'],
      },
      {
        name: "lines only removed read as a count",
        data: {
          kind: "edit",
          content: [{ type: "diff", path: "/srv/f.txt", oldText: "a\nb\nc\nd", newText: "a\nd" }],
        },
        writes: [{ path: "/srv/f.txt", kind: "edit", changes: [wrote("", 2)] }],
        never: ["b", "c"],
      },
    ],
  ],
];

describe.each(DRIVERS)("readFileWrites — %s", (_driver, cases) => {
  it.each(cases)("$name", ({ data, writes, never = [] }) => {
    const read = readFileWrites(data);
    expect(read).toEqual(writes.map((write) => ({ ...write, truncated: false })));
    expect(hasFileWrites(data)).toBe(writes.length > 0);
    for (const secret of never) {
      expect(seen(read).split("\n")).not.toContain(secret);
      expect(seen(read)).not.toContain(secret);
    }
  });
});

describe("readFileWrites — what a reader sees", () => {
  it("a path exactly as named, a space around it too", () => {
    const [write] = readFileWrites({
      toolName: "Write",
      input: { file_path: " /srv/a.md", content: "a" },
    });
    expect(write?.path).toBe(" /srv/a.md");
  });

  it("cuts a long text at a line, and says so", () => {
    const line = "x".repeat(99);
    const content = Array.from({ length: 2000 }, () => line).join("\n");
    const [write] = readFileWrites({ toolName: "Write", input: { file_path: "/a", content } });
    expect(write?.truncated).toBe(true);
    const text = write?.changes.map((change) => change.text).join("") ?? "";
    expect(text.length).toBeLessThanOrEqual(FILE_WRITE_TEXT_MAX_CHARS);
    expect(text.endsWith(line)).toBe(true);
  });
});

describe("readFileWritePaths", () => {
  it.each([
    {
      name: "every file a call wrote, an empty one too",
      data: { toolName: "Write", input: { file_path: "/srv/empty", content: "" } },
      paths: ["/srv/empty"],
    },
    {
      name: "Codex: added and updated, never deleted",
      data: {
        item: {
          type: "fileChange",
          changes: [
            { path: "/a", kind: { type: "add" }, diff: "" },
            { path: "/b", kind: { type: "update", move_path: "/c" }, diff: "" },
            { path: "/d", kind: { type: "delete" }, diff: "" },
          ],
        },
      },
      paths: ["/a", "/c"],
    },
    {
      name: "a read",
      data: { toolName: "Read", input: { file_path: "/etc/passwd" } },
      paths: [],
    },
    {
      name: "a path with a space around it: another file than its trim, never recorded",
      data: { toolName: "Write", input: { file_path: "/home/u/.claude.json ", content: "x" } },
      paths: [],
    },
    {
      name: "a patch header with a space after its path",
      data: { tool: "apply_patch", input: { patchText: "*** Add File: /srv/a.md \n+x" } },
      paths: [],
    },
  ])("$name", ({ data, paths }) => {
    expect(readFileWritePaths(data)).toEqual(paths);
  });
});

describe("lineChanges", () => {
  it.each([
    { before: "a", after: "a", changes: [] },
    { before: "", after: "a", changes: [wrote("a")] },
    { before: "a\nb", after: "a\nc\nb", changes: [wrote("c")] },
    { before: "a\nb\nc", after: "a\nc", changes: [wrote("", 1)] },
    {
      before: "1\n2\n3\n4\n5",
      after: "1\nTWO\n3\n4\nFIVE",
      changes: [wrote("TWO", 1), wrote("FIVE", 1)],
    },
  ])("$before → $after", ({ before, after, changes }) => {
    expect(lineChanges(before, after)).toEqual(changes);
  });

  it("stays linear on a large rewrite", () => {
    const before = Array.from({ length: 5000 }, (_, index) => `old ${index}`).join("\n");
    const after = Array.from({ length: 5000 }, (_, index) => `new ${index}`).join("\n");
    const [change] = lineChanges(before, after);
    expect(change?.removedLines).toBe(5000);
    expect(change?.text.split("\n")).toHaveLength(5000);
  });
});
