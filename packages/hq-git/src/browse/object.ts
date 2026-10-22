/**
 * What a path names in a commit, read before the commit's folder or file is: whether the commit
 * is there, and the path's object — its mode, type, id and size.
 *
 * @module browse/object
 */
import { GitError } from "../api.ts";
import type { GitRunner } from "../git.ts";

export interface PathObject {
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  /** A blob's bytes; none for a tree or a submodule's commit. */
  readonly size: number | null;
}

export type Lookup =
  | { readonly kind: "found"; readonly object: PathObject }
  | { readonly kind: "commit-missing" }
  | { readonly kind: "path-missing" };

const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** One `ls-tree` record: `<mode> <type> <object> <size>\t<name>`, size `-` past a blob. */
export const parseRecord = (record: string) => {
  const tab = record.indexOf("\t");
  const [mode = "", type = "", sha = "", size = "-"] = record.slice(0, tab).split(/ +/u);
  return {
    name: record.slice(tab + 1),
    object: { mode, type, sha, size: size === "-" ? null : Number(size) } satisfies PathObject,
  };
};

export const lookupPath = async (
  git: GitRunner,
  dir: string,
  sha: string,
  path: string,
  signal: AbortSignal,
): Promise<Lookup> => {
  if (!COMMIT.test(sha))
    throw new GitError({
      operation: "browse.lookup",
      reason: "invalid_config",
      message: "Invalid commit",
    });
  const commit = `${sha}^{commit}`;
  if (path === "") {
    const tree = await git.exec(
      ["-C", dir, "rev-parse", "--verify", "--quiet", `${commit}^{tree}`],
      {
        signal,
        acceptExitCodes: [1, 128],
      },
    );
    const id = tree.stdout.toString().trim();
    return tree.code === 0 && id !== ""
      ? { kind: "found", object: { mode: "040000", type: "tree", sha: id, size: null } }
      : { kind: "commit-missing" };
  }
  // Pathspecs read literally: a name with `*` or a leading `:` is that name, nothing else.
  const listed = await git.exec(
    ["--literal-pathspecs", "-C", dir, "ls-tree", "-l", "-z", commit, "--", path],
    { signal, acceptExitCodes: [128] },
  );
  if (listed.code !== 0) return { kind: "commit-missing" };
  const found = listed.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .map(parseRecord)
    .find((record) => record.name === path);
  return found === undefined ? { kind: "path-missing" } : { kind: "found", object: found.object };
};
