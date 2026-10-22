// @effect-diagnostics nodeBuiltinImport:off - native streams and an isolated git index.
/**
 * A commit's files as one archive, `tar.gz` or `zip`, streamed while git writes it: the bytes git
 * stores, without a prefix, and its git stopped when the reader lets the stream go.
 *
 * @module browse/archive
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import { terminate, type GitRunner } from "../git.ts";
import { lookupPath } from "./object.ts";

export type ArchiveFormat = "tar.gz" | "zip";

/** `sha`'s archive in `format`; the commit must be in the repository. */
export const streamArchive = async (
  git: GitRunner,
  dir: string,
  sha: string,
  format: ArchiveFormat,
  signal: AbortSignal,
) => {
  // Empty worktree/index suppress export-ignore and export-subst: archive exact stored bytes.
  const temp = await NodeFSP.mkdtemp(NodePath.join(dir, ".archive-"));
  const process = git.start(
    [
      "-C",
      dir,
      "-c",
      "core.bare=false",
      "-c",
      "tar.umask=0022",
      "archive",
      "--worktree-attributes",
      `--format=${format}`,
      sha,
    ],
    {
      signal,
      env: { GIT_WORK_TREE: temp, GIT_INDEX_FILE: NodePath.join(temp, "index") },
    },
  );
  const cleanup = process.done.finally(() => NodeFSP.rm(temp, { recursive: true, force: true }));
  void cleanup.catch(() => {});
  process.child.stdin.end();
  const stream = new NodeStream.PassThrough({
    flush(callback) {
      void cleanup.then(
        () => callback(),
        () => callback(new Error("Git archive failed")),
      );
    },
    destroy(cause, callback) {
      process.child.stdout.unpipe();
      process.child.stdout.resume();
      terminate(process.child);
      void cleanup.catch(() => {}).then(() => callback(cause));
    },
  });
  process.child.stdout.on("error", () => stream.destroy(new Error("Git archive failed")));
  void process.done.then(
    () => {},
    () => {
      if (!stream.destroyed) stream.destroy(new Error("Git archive failed"));
    },
  );
  process.child.stdout.pipe(stream);
  return stream;
};

/** A commit's archive as the Git browser downloads it; none where the repository has no such commit. */
export const archiveAt = async (
  git: GitRunner,
  dir: string,
  sha: string,
  format: ArchiveFormat,
  signal: AbortSignal,
): Promise<NodeStream.Readable | null> =>
  (await lookupPath(git, dir, sha, "", signal)).kind === "commit-missing"
    ? null
    : streamArchive(git, dir, sha, format, signal);
