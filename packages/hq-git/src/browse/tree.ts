/**
 * A folder of a commit as the browser lists it: folders first, then everything else, each by
 * name, at most {@link TREE_ENTRIES_LIMIT} of them.
 *
 * @module browse/tree
 */
import type { GitRunner } from "../git.ts";
import { lookupPath, parseRecord } from "./object.ts";

export const TREE_ENTRIES_LIMIT = 1000;
/** Bytes of a listing read: a record cut by it is dropped, and the answer says it stops. */
const BYTES_LIMIT = 4 * 1024 * 1024;

export type FolderEntryType = "file" | "folder" | "symlink" | "submodule";

export interface FolderEntry {
  readonly name: string;
  readonly path: string;
  readonly type: FolderEntryType;
  readonly mode: string;
  readonly sha: string;
  readonly size?: number;
}

export type TreeRead =
  | {
      readonly kind: "tree";
      readonly entries: ReadonlyArray<FolderEntry>;
      readonly truncated: boolean;
    }
  | { readonly kind: "commit-missing" }
  | { readonly kind: "path-missing" };

const typeOf = (mode: string, type: string): FolderEntryType =>
  type === "tree"
    ? "folder"
    : type === "commit"
      ? "submodule"
      : mode === "120000"
        ? "symlink"
        : "file";

const byName = (a: FolderEntry, b: FolderEntry) =>
  a.type === "folder" && b.type !== "folder"
    ? -1
    : b.type === "folder" && a.type !== "folder"
      ? 1
      : a.name < b.name
        ? -1
        : a.name > b.name
          ? 1
          : 0;

export const listTree = async (
  git: GitRunner,
  dir: string,
  sha: string,
  path: string,
  signal: AbortSignal,
): Promise<TreeRead> => {
  const found = await lookupPath(git, dir, sha, path, signal);
  if (found.kind !== "found") return found;
  if (found.object.type !== "tree") return { kind: "path-missing" };
  const read = await git.prefix(
    ["-C", dir, "ls-tree", "-l", "-z", found.object.sha],
    signal,
    BYTES_LIMIT,
  );
  const records = read.bytes.toString().split("\0");
  if (read.truncated) records.pop();
  // Sorted whole, so a folder past the cut still lists before the files.
  const entries = records
    .filter(Boolean)
    .map(parseRecord)
    .map(({ name, object }): FolderEntry => {
      const type = typeOf(object.mode, object.type);
      return {
        name,
        path: path === "" ? name : `${path}/${name}`,
        type,
        mode: object.mode,
        sha: object.sha,
        ...(object.size === null || type === "submodule" ? {} : { size: object.size }),
      };
    })
    .sort(byName);
  return {
    kind: "tree",
    entries: entries.slice(0, TREE_ENTRIES_LIMIT),
    truncated: read.truncated || entries.length > TREE_ENTRIES_LIMIT,
  };
};
