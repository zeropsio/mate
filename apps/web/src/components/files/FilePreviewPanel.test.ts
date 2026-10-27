import { ProjectReadFileError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  formatFileCommentRange,
  normalizeFileCommentRange,
  remapFileCommentAnnotations,
} from "./fileCommentAnnotations";
import {
  filePreviewReadFailure,
  isMarkdownPreviewFile,
  setMarkdownTaskChecked,
} from "./filePreviewMode";

const decodeReadError = Schema.decodeSync(ProjectReadFileError);

describe("a file preview that could not read its file", () => {
  it.each([
    ["path_not_file", "The path is a folder or a special file, not a file."],
    ["binary_file", "The file is binary and can't be shown as text."],
    ["workspace_path_outside_root", "The path is outside the project's folder."],
    ["resolved_path_outside_root", "The path leads outside the project's folder."],
    ["operation_failed", "The file couldn't be read. It may be missing or not readable."],
  ] as const)("says why for %s, never the platform's own words", (failure, message) => {
    const error = new ProjectReadFileError({
      cwd: "/var/www/app",
      relativePath: "docs/outline.md",
      failure,
      operation: "realpath-target",
      resolvedPath: "/var/www/app/docs/outline.md",
      cause: new Error("EACCES: sensitive platform detail"),
    });
    expect(filePreviewReadFailure(error, "/var/www/app")).toEqual({
      message,
      attemptedPath: "/var/www/app/docs/outline.md",
      workspaceFolder: "/var/www/app",
    });
  });

  it("tells a project folder it couldn't open from a file it couldn't read", () => {
    const error = new ProjectReadFileError({
      cwd: "/var/www/app",
      relativePath: "outline.md",
      failure: "operation_failed",
      operation: "realpath-workspace-root",
      operationPath: "/var/www/app",
    });
    expect(filePreviewReadFailure(error, "/var/www/app")).toEqual({
      message: "The project's folder couldn't be opened.",
      attemptedPath: "/var/www/app",
      workspaceFolder: "/var/www/app",
    });
  });

  it("keeps an older server's own words, and names no path it did not say", () => {
    const error = decodeReadError({
      _tag: "ProjectReadFileError",
      message: "Legacy file read failure.",
    });
    expect(filePreviewReadFailure(error, "/var/www/app")).toEqual({
      message: "Legacy file read failure.",
      attemptedPath: null,
      workspaceFolder: "/var/www/app",
    });
  });
});

describe("file comment annotations", () => {
  it("normalizes and formats selected line ranges", () => {
    expect(normalizeFileCommentRange({ start: 16, end: 7 })).toEqual({
      startLine: 7,
      endLine: 16,
    });
    expect(formatFileCommentRange(7, 7)).toBe("L7");
    expect(formatFileCommentRange(7, 16)).toBe("L7 to L16");
  });

  it("keeps an annotation range attached when Pierre remaps its anchor line", () => {
    expect(
      remapFileCommentAnnotations([
        {
          lineNumber: 20,
          metadata: {
            entries: [
              {
                id: "comment-1",
                kind: "comment",
                startLine: 7,
                endLine: 16,
                text: "Keep this guarded.",
              },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        lineNumber: 20,
        metadata: {
          entries: [
            {
              id: "comment-1",
              kind: "comment",
              startLine: 11,
              endLine: 20,
              text: "Keep this guarded.",
            },
          ],
        },
      },
    ]);
  });
});

describe("isMarkdownPreviewFile", () => {
  it("recognizes markdown and MDX files case-insensitively", () => {
    expect(isMarkdownPreviewFile("README.md")).toBe(true);
    expect(isMarkdownPreviewFile("docs/guide.MDX")).toBe(true);
  });

  it("does not treat other text files as markdown", () => {
    expect(isMarkdownPreviewFile("docs/guide.txt")).toBe(false);
    expect(isMarkdownPreviewFile("docs/markdown.ts")).toBe(false);
  });
});

describe("setMarkdownTaskChecked", () => {
  const markdown = "- [ ] First\n- [x] Second\n";

  it("checks and unchecks the task marker at the supplied offset", () => {
    expect(setMarkdownTaskChecked(markdown, 2, true)).toBe("- [x] First\n- [x] Second\n");
    expect(setMarkdownTaskChecked(markdown, 14, false)).toBe("- [ ] First\n- [ ] Second\n");
    expect(setMarkdownTaskChecked("1. [X] Ordered\n", 3, false)).toBe("1. [ ] Ordered\n");
  });

  it("leaves the document unchanged for a stale or invalid marker offset", () => {
    expect(setMarkdownTaskChecked(markdown, 0, true)).toBe(markdown);
    expect(setMarkdownTaskChecked(markdown, 200, true)).toBe(markdown);
  });
});
