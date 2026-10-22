/**
 * `tree`: a folder of a commit (`@t3tools/shared/hqGitBrowse/tree`). Pinned to its commit, it is
 * read once while held.
 *
 * @module zerops/gitBrowse/tree
 */
import { GitTree, GitTreeQuery, type GitTreeEntryType } from "@t3tools/shared/hqGitBrowse/tree";

export const treeRead = { query: GitTreeQuery, value: GitTree, moving: false } as const;

const LABELS: Record<GitTreeEntryType, string> = {
  file: "File",
  folder: "Folder",
  symlink: "Symbolic link",
  submodule: "Submodule",
};
export const entryLabel = (type: GitTreeEntryType) => LABELS[type];

/** The folders above a path, the top folder first: `a/b/c.ts` → `""`, `a`, `a/b`. */
export const foldersAbove = (path: string): ReadonlyArray<string> => {
  const segments = path === "" ? [] : path.split("/");
  return segments.map((_, index) => segments.slice(0, index).join("/"));
};

/** Folder reads a tree keeps in flight at once. */
export const TREE_READS_IN_FLIGHT = 4;

/**
 * The folders a tree reads, in the order they were opened: every one already read or reading,
 * then the next waiting ones while fewer than {@link TREE_READS_IN_FLIGHT} are still reading.
 */
export const folderReads = (
  opened: ReadonlyArray<string>,
  state: (folder: string) => "read" | "reading" | "waiting",
): ReadonlyArray<string> => {
  let reading = opened.filter((folder) => state(folder) === "reading").length;
  return opened.filter((folder) => {
    const now = state(folder);
    if (now !== "waiting") return true;
    if (reading >= TREE_READS_IN_FLIGHT) return false;
    reading++;
    return true;
  });
};
