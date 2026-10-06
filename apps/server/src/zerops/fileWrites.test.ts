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
        name: "a line marked removed and added unchanged is no change",
        data: {
          item: {
            type: "fileChange",
            changes: [
              {
                path: "/srv/c.txt",
                kind: { type: "update", move_path: null },
                diff: "@@ -1,2 +1,2 @@\n-SAME=tie-secret\n-old=1\n+SAME=tie-secret\n+new=1",
              },
            ],
          },
        },
        writes: [{ path: "/srv/c.txt", kind: "edit", changes: [wrote("new=1", 1)] }],
        never: ["SAME=tie-secret", "old=1"],
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
        writes: [{ path: "/home/u/.docker/config.json", kind: "edit", changes: [wrote("…2", 1)] }],
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
      {
        name: "one word changed in a line: only the characters that differ, never the line",
        data: {
          kind: "edit",
          content: [
            {
              type: "diff",
              path: "/srv/app/.env",
              oldText: "DATABASE_URL=postgres://app:S3cr3t@db:5432/app\nPORT=3000",
              newText: "DATABASE_URL=postgres://app:S3cr3t@db2:5432/app\nPORT=3000",
            },
          ],
        },
        writes: [{ path: "/srv/app/.env", kind: "edit", changes: [wrote("…2…", 1)] }],
        never: ["S3cr3t", "DATABASE_URL", "postgres://app:S3cr3t@db2:5432/app", "PORT=3000"],
      },
      {
        name: "a password on the line of a one-word change stays unsent",
        data: {
          kind: "edit",
          content: [
            {
              type: "diff",
              path: "/srv/app/config.ini",
              oldText: "user=admin password=hunter2 mode=dev",
              newText: "user=admin password=hunter2 mode=prod",
            },
          ],
        },
        writes: [{ path: "/srv/app/config.ini", kind: "edit", changes: [wrote("…prod", 1)] }],
        never: ["hunter2", "password=hunter2", "user=admin"],
      },
      {
        name: "a line that stands unchanged in the old text is never added",
        data: {
          kind: "edit",
          content: [
            {
              type: "diff",
              path: "/srv/app/vars",
              oldText: "a=1\nTOKEN=untouched-secret\nb=2",
              newText: "b=2\nTOKEN=untouched-secret\nc=3",
            },
          ],
        },
        writes: [{ path: "/srv/app/vars", kind: "edit", changes: [wrote("", 1), wrote("c=3")] }],
        never: ["TOKEN=untouched-secret", "a=1", "b=2"],
      },
      {
        name: "a block moved, nothing else changed: nothing to show",
        data: {
          kind: "edit",
          content: [
            {
              type: "diff",
              path: "/srv/app/list",
              oldText: "KEY=secret-one\nother=two\nthird=3",
              newText: "third=3\nKEY=secret-one\nother=two",
            },
          ],
        },
        writes: [],
        never: ["KEY=secret-one"],
      },
      {
        name: "the agent's own new_string, when its raw input carries it",
        data: {
          kind: "edit",
          rawInput: { file_path: "/srv/app/.env", old_string: "PORT=1", new_string: "PORT=2" },
          content: [
            {
              type: "diff",
              path: "/srv/app/.env",
              oldText: "PASSWORD=old-secret\nPORT=1\nKEEP=kept-secret",
              newText: "PASSWORD=old-secret\nPORT=2\nKEEP=kept-secret",
            },
          ],
        },
        // Worked out from the whole file it would be `…2`: the call says `PORT=2`.
        writes: [{ path: "/srv/app/.env", kind: "edit", changes: [wrote("PORT=2", 1)] }],
        never: ["old-secret", "kept-secret"],
      },
      {
        name: "the agent's own newString, as OpenCode-style keys spell it",
        data: {
          kind: "edit",
          rawInput: { filePath: "/srv/a.txt", oldString: "x", newString: "y" },
          content: [
            {
              type: "diff",
              path: "/srv/a.txt",
              oldText: "shared-secret\nx",
              newText: "shared-secret\ny",
            },
          ],
        },
        writes: [{ path: "/srv/a.txt", kind: "edit", changes: [wrote("y", 1)] }],
        never: ["shared-secret"],
      },
      {
        name: "the agent's own content: a whole file it wrote",
        data: {
          kind: "edit",
          rawInput: { path: "/srv/b.txt", content: "all of it" },
          content: [
            { type: "diff", path: "/srv/b.txt", oldText: "before-secret", newText: "all of it" },
          ],
        },
        writes: [{ path: "/srv/b.txt", kind: "write", changes: [wrote("all of it")] }],
        never: ["before-secret"],
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
