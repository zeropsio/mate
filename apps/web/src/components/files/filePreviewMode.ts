import type { ProjectReadFileError } from "@t3tools/contracts";

export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

/** What a preview that could not read its file says: why, the path it tried, where it looked. */
export interface FilePreviewReadFailure {
  readonly message: string;
  readonly attemptedPath: string | null;
  readonly workspaceFolder: string;
}

/**
 * Why a preview could not read its file, in words for the person — never the platform's own
 * cause, which can name more than the person should see — with the path it tried, so a link
 * to the wrong place can be told from a file that is gone.
 */
export function filePreviewReadFailure(
  error: ProjectReadFileError,
  cwd: string,
): FilePreviewReadFailure {
  return {
    message: readFailureWords(error),
    attemptedPath: error.resolvedPath ?? error.operationPath ?? null,
    workspaceFolder: error.cwd ?? cwd,
  };
}

function readFailureWords(error: ProjectReadFileError): string {
  switch (error.failure) {
    case "path_not_file":
      return "The path is a folder or a special file, not a file.";
    case "binary_file":
      return "The file is binary and can't be shown as text.";
    case "workspace_path_outside_root":
      return "The path is outside the project's folder.";
    case "resolved_path_outside_root":
      return "The path leads outside the project's folder.";
    case "operation_failed":
      // A failed realpath can mean a missing path, permissions or another I/O error.
      return error.operation === "realpath-workspace-root"
        ? "The project's folder couldn't be opened."
        : "The file couldn't be read. It may be missing or not readable.";
    default:
      return error.message;
  }
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}
