import { describe, expect, it } from "@effect/vitest";

import {
  FILE_WRITE_TEXT_MAX_CHARS,
  hasFileWrites,
  lineDiff,
  readFileWritePaths,
  readFileWrites,
} from "./fileWrites.ts";

describe("readFileWrites", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly data: unknown;
    readonly writes: ReadonlyArray<{
      readonly path: string;
      readonly kind: "write" | "edit";
      readonly format: "content" | "diff";
      readonly text: string;
    }>;
  }> = [
    {
      name: "Claude Write: the file's content",
      data: { toolName: "Write", input: { file_path: "/srv/app/notes.md", content: "a\nb\n" } },
      writes: [{ path: "/srv/app/notes.md", kind: "write", format: "content", text: "a\nb\n" }],
    },
    {
      name: "Claude Edit: the change",
      data: {
        toolName: "Edit",
        input: { file_path: "/srv/app/a.ts", old_string: "x\ny\nz", new_string: "x\nY\nz" },
      },
      writes: [{ path: "/srv/app/a.ts", kind: "edit", format: "diff", text: " x\n-y\n+Y\n z" }],
    },
    {
      name: "Claude MultiEdit: each change, a gap between them",
      data: {
        toolName: "MultiEdit",
        input: {
          file_path: "/srv/app/a.ts",
          edits: [
            { old_string: "one", new_string: "uno" },
            { old_string: "two", new_string: "dos" },
          ],
        },
      },
      writes: [
        { path: "/srv/app/a.ts", kind: "edit", format: "diff", text: "-one\n+uno\n@@\n-two\n+dos" },
      ],
    },
    {
      name: "Claude NotebookEdit: the cell's new source",
      data: {
        toolName: "NotebookEdit",
        input: { notebook_path: "/srv/n.ipynb", new_source: "print(1)", edit_mode: "replace" },
      },
      writes: [{ path: "/srv/n.ipynb", kind: "edit", format: "content", text: "print(1)" }],
    },
    {
      name: "Claude NotebookEdit deleting a cell: nothing to draw",
      data: {
        toolName: "NotebookEdit",
        input: { notebook_path: "/srv/n.ipynb", new_source: "", edit_mode: "delete" },
      },
      writes: [],
    },
    {
      name: "Codex file change: an added file's content, an update's diff without its headers",
      data: {
        item: {
          type: "fileChange",
          id: "call-1",
          status: "completed",
          changes: [
            { path: "/srv/app/new.ts", kind: { type: "add" }, diff: "export {};\n" },
            {
              path: "/srv/app/old.ts",
              kind: { type: "update", move_path: null },
              diff: "--- a/old.ts\n+++ b/old.ts\n@@ -1,2 +1,2 @@\n keep\n-was\n+is\n",
            },
            { path: "/srv/app/gone.ts", kind: { type: "delete" }, diff: "bye\n" },
          ],
        },
      },
      writes: [
        { path: "/srv/app/new.ts", kind: "write", format: "content", text: "export {};\n" },
        { path: "/srv/app/old.ts", kind: "edit", format: "diff", text: "@@\n keep\n-was\n+is" },
      ],
    },
    {
      name: "Codex moved file: named where it went",
      data: {
        item: {
          type: "fileChange",
          changes: [
            { path: "/a.ts", kind: { type: "update", move_path: "/b.ts" }, diff: "@@\n-x\n+y" },
          ],
        },
      },
      writes: [{ path: "/b.ts", kind: "edit", format: "diff", text: "@@\n-x\n+y" }],
    },
    {
      name: "OpenCode write",
      data: { tool: "write", state: { input: { filePath: "/srv/x.txt", content: "hi" } } },
      writes: [{ path: "/srv/x.txt", kind: "write", format: "content", text: "hi" }],
    },
    {
      name: "OpenCode edit",
      data: {
        tool: "edit",
        input: { filePath: "/srv/x.txt", oldString: "hi", newString: "hello" },
      },
      writes: [{ path: "/srv/x.txt", kind: "edit", format: "diff", text: "-hi\n+hello" }],
    },
    {
      name: "OpenCode multiedit",
      data: {
        tool: "multiedit",
        input: {
          filePath: "/srv/x.txt",
          edits: [{ filePath: "/srv/x.txt", oldString: "a", newString: "b" }],
        },
      },
      writes: [{ path: "/srv/x.txt", kind: "edit", format: "diff", text: "-a\n+b" }],
    },
    {
      name: "OpenCode / Codex apply_patch text: a file each",
      data: {
        tool: "apply_patch",
        input: {
          patchText: [
            "*** Begin Patch",
            "*** Add File: /srv/new.md",
            "+# Title",
            "+body",
            "*** Update File: /srv/old.md",
            "@@ intro",
            " keep",
            "-was",
            "+is",
            "*** Delete File: /srv/gone.md",
            "*** End Patch",
          ].join("\n"),
        },
      },
      writes: [
        { path: "/srv/new.md", kind: "write", format: "content", text: "# Title\nbody" },
        { path: "/srv/old.md", kind: "edit", format: "diff", text: "@@\n keep\n-was\n+is" },
      ],
    },
    {
      name: "ACP diff (Cursor, Grok, Antigravity): a new file",
      data: {
        kind: "edit",
        content: [{ type: "diff", path: "/srv/n.txt", oldText: null, newText: "new" }],
      },
      writes: [{ path: "/srv/n.txt", kind: "write", format: "content", text: "new" }],
    },
    {
      name: "ACP diff of a whole file: only the changed part, three lines around it",
      data: {
        kind: "edit",
        content: [
          { type: "content", content: { type: "text", text: "Edited." } },
          {
            type: "diff",
            path: "/srv/f.txt",
            oldText: "1\n2\n3\n4\n5\n6\n7\n8\n9",
            newText: "1\n2\n3\n4\nFIVE\n6\n7\n8\n9",
          },
        ],
      },
      writes: [
        {
          path: "/srv/f.txt",
          kind: "edit",
          format: "diff",
          text: "@@\n 2\n 3\n 4\n-5\n+FIVE\n 6\n 7\n 8\n@@",
        },
      ],
    },
    {
      name: "a path drawn exactly as named, a space around it too",
      data: { toolName: "Write", input: { file_path: " /srv/a.md", content: "a" } },
      writes: [{ path: " /srv/a.md", kind: "write", format: "content", text: "a" }],
    },
    {
      name: "a read names a file but wrote nothing",
      data: { toolName: "Read", input: { file_path: "/srv/a.ts" } },
      writes: [],
    },
    {
      name: "a payload already slimmed for a client keeps no text: nothing to draw",
      data: {
        toolName: "Write",
        input: { file_path: "/srv/a.ts" },
        files: [{ path: "/srv/a.ts" }],
      },
      writes: [],
    },
    { name: "no data", data: undefined, writes: [] },
  ];

  it.each(cases)("$name", ({ data, writes }) => {
    expect(readFileWrites(data)).toEqual(writes.map((write) => ({ ...write, truncated: false })));
    expect(hasFileWrites(data)).toBe(writes.length > 0);
  });

  it("cuts a long text at a line, and says so", () => {
    const line = "x".repeat(99);
    const content = Array.from({ length: 2000 }, () => line).join("\n");
    const [write] = readFileWrites({ toolName: "Write", input: { file_path: "/a", content } });
    expect(write?.truncated).toBe(true);
    expect(write?.text.length).toBeLessThanOrEqual(FILE_WRITE_TEXT_MAX_CHARS);
    expect(write?.text.endsWith(line)).toBe(true);
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

describe("lineDiff", () => {
  it.each([
    { before: "a", after: "a", diff: "" },
    { before: "", after: "a", diff: "+a" },
    { before: "a\nb", after: "a\nc\nb", diff: " a\n+c\n b" },
    { before: "a\nb\nc", after: "a\nc", diff: " a\n-b\n c" },
  ])("$before → $after", ({ before, after, diff }) => {
    expect(lineDiff(before, after)).toBe(diff);
  });

  it("stays linear on a large rewrite", () => {
    const before = Array.from({ length: 5000 }, (_, index) => `old ${index}`).join("\n");
    const after = Array.from({ length: 5000 }, (_, index) => `new ${index}`).join("\n");
    const diff = lineDiff(before, after).split("\n");
    expect(diff.filter((line) => line.startsWith("-"))).toHaveLength(5000);
    expect(diff.filter((line) => line.startsWith("+"))).toHaveLength(5000);
  });
});
