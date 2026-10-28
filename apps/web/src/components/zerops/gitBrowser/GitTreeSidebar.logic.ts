/**
 * What the repository's folder tree draws from the folders it has read: every entry of each read
 * folder, the opened folders expanded, and the page's file or folder selected.
 */
import { folderReads, foldersAbove } from "@t3tools/client-runtime/zerops/gitBrowse/tree";
import type { GitTree } from "@t3tools/shared/hqGitBrowse/tree";
import type { FileTree } from "@pierre/trees";
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

/** Apply the projection to the tree that owns expansion, selection and keyboard focus. */
export function syncTree(
  model: FileTree,
  shape: TreeShape,
  at: RepoPathTarget,
  collapsed: Set<string>,
) {
  // A tree click has already selected its target and may have just collapsed it. Only a link
  // from outside the tree (or a target whose listing just arrived) needs its ancestors revealed.
  const reveal = shape.selected !== null && !model.getSelectedPaths().includes(shape.selected);
  const wayDown = new Set(foldersOpenedAt(at).map(folderRow));
  model.resetPaths(shape.rows, {
    initialExpandedPaths: shape.expanded,
  });
  // Pierre expands ancestors of every initial expanded path. Restore explicit closures after
  // that expansion so a hidden descendant does not reopen its parent during a listing update.
  for (const row of collapsed) {
    if (reveal && wayDown.has(row)) {
      collapsed.delete(row);
      continue;
    }
    const item = model.getItem(row);
    if (item !== null && "collapse" in item) item.collapse();
  }
  for (const row of model.getSelectedPaths())
    if (row !== shape.selected) model.getItem(row)?.deselect();
  if (shape.selected !== null) {
    model.getItem(shape.selected)?.select();
    if (reveal) model.scrollToPath(shape.selected, { offset: "center" });
  }
}
