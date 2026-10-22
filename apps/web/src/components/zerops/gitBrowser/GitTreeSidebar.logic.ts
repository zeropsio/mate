/**
 * What the repository's folder tree draws from the folders it has read: every entry of each read
 * folder, the opened folders expanded, and the page's file or folder selected.
 */
import { folderReads, foldersAbove } from "@t3tools/client-runtime/zerops/gitBrowse/tree";
import type { GitTree } from "@t3tools/shared/hqGitBrowse/tree";
import type { RepoPathTarget } from "./RepoMarkdown";

/** A folder in the tree's terms: its path with a trailing slash, as the tree tells folders apart. */
export const folderRow = (path: string) => `${path}/`;
/** A tree row's repository path. */
export const rowPath = (row: string) => row.replace(/\/$/u, "");

/** The folders a page opens on: the top folder, every folder above it, and the folder it is. */
export const foldersOpenedAt = (at: RepoPathTarget): ReadonlyArray<string> => {
  if (at.path === "") return [""];
  const above = foldersAbove(at.path);
  return at.kind === "tree" ? [...above, at.path] : above;
};

/**
 * The folders to read now, in the order opened: those asked before stay asked while they read,
 * and the next ones join while fewer than four are reading.
 */
export const foldersToAsk = (
  opened: ReadonlyArray<string>,
  asked: ReadonlyArray<string>,
  read: ReadonlySet<string>,
) =>
  folderReads(opened, (folder) =>
    read.has(folder) ? "read" : asked.includes(folder) ? "reading" : "waiting",
  );

export interface TreeShape {
  readonly rows: ReadonlyArray<string>;
  readonly expanded: ReadonlyArray<string>;
  readonly selected: string | null;
}

export const treeShape = (
  opened: ReadonlyArray<string>,
  folders: ReadonlyMap<string, GitTree>,
  at: RepoPathTarget,
): TreeShape => {
  const rows: Array<string> = [];
  for (const folder of opened)
    for (const entry of folders.get(folder)?.entries ?? [])
      rows.push(entry.type === "folder" ? folderRow(entry.path) : entry.path);
  const present = new Set(rows);
  const selected = at.path === "" ? null : at.kind === "tree" ? folderRow(at.path) : at.path;
  return {
    rows,
    expanded: opened.filter((folder) => present.has(folderRow(folder))).map(folderRow),
    selected: selected !== null && present.has(selected) ? selected : null,
  };
};
