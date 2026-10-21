/**
 * The README a repository's home shows, picked as GitHub picks it: `.github/` before the root,
 * the root before `docs/`, and within a folder by name, case-insensitively.
 *
 * @module browse/readme
 */
import { GitError } from "../api.ts";
import type { GitRunner } from "../git.ts";

const NAMES = ["readme", "readme.md", "readme.markdown", "readme.txt"];
const FOLDERS = [".github", "", "docs"];

export interface Readme {
  readonly path: string;
  readonly content: string;
  readonly truncated: boolean;
}

interface Entry {
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  readonly name: string;
}

const entries = async (git: GitRunner, dir: string, tree: string, signal: AbortSignal) => {
  // A folder of more names than this is no place a README hides in.
  const read = await git.prefix(["-C", dir, "ls-tree", "-z", tree], signal, 1024 * 1024);
  const records = read.bytes.toString().split("\0");
  if (read.truncated) records.pop();
  return records.filter(Boolean).map((record): Entry => {
    const tab = record.indexOf("\t");
    const [mode = "", type = "", sha = ""] = record.slice(0, tab).split(" ");
    return { mode, type, sha, name: record.slice(tab + 1) };
  });
};

export const findReadme = async (
  git: GitRunner,
  dir: string,
  sha: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Readme | null> => {
  if (!/^[0-9a-f]{40}$/u.test(sha))
    throw new GitError({
      operation: "browse.readme",
      reason: "invalid_config",
      message: "Invalid commit",
    });
  const root = await entries(git, dir, sha, signal);
  for (const folder of FOLDERS) {
    const tree =
      folder === "" ? root : root.find((entry) => entry.name === folder && entry.type === "tree");
    if (tree === undefined) continue;
    const listed = Array.isArray(tree) ? tree : await entries(git, dir, tree.sha, signal);
    const found = NAMES.flatMap((name) =>
      listed.filter(
        (entry) =>
          entry.type === "blob" &&
          (entry.mode === "100644" || entry.mode === "100755") &&
          entry.name.toLowerCase() === name,
      ),
    )[0];
    if (found === undefined) continue;
    const blob = await git.prefix(
      ["-C", dir, "cat-file", "blob", found.sha],
      signal,
      // Never more than a file read takes.
      Math.min(Math.max(1, Math.floor(maxBytes)), 1024 * 1024),
    );
    return {
      path: folder === "" ? found.name : `${folder}/${found.name}`,
      content: blob.bytes.toString("utf8"),
      truncated: blob.truncated,
    };
  }
  return null;
};
