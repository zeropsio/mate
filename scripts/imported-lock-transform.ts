// @effect-diagnostics nodeBuiltinImport:off -- git object hashing and a git cat-file reader for imported.lock.
/**
 * Proves a transformed Import-zone path is exactly `transform(upstream)`, without upstream's
 * objects: restore every file at HEAD with the transform's inverse, hash the restored tree the
 * way git does, and compare it with upstream's tree OID; then re-apply the transform to the
 * restored files and compare with HEAD byte for byte.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

import { restoreImportZoneFile, transformImportZoneFile } from "./effect-401-codemod.ts";

export interface TreeFile {
  /** Path relative to the tree's root, `/`-separated. */
  readonly path: string;
  /** Git file mode: 100644, 100755 or 120000. */
  readonly mode: string;
  readonly content: Buffer;
}

/** A transform the Import zone carries until its next re-import. */
export interface ImportTransform {
  readonly apply: (path: string, content: Buffer) => Buffer;
  readonly restore: (path: string, content: Buffer) => Buffer;
}

const TEXT = /\.(?:[cm]?[jt]sx?|json|jsonc|md|mdx|ya?ml)$/u;

const textTransform =
  (rewrite: (path: string, text: string) => string) => (path: string, content: Buffer) =>
    TEXT.test(path) ? Buffer.from(rewrite(path, content.toString("utf8")), "utf8") : content;

export const IMPORT_TRANSFORMS: Readonly<Record<string, ImportTransform>> = {
  "effect-401": {
    apply: textTransform(transformImportZoneFile),
    restore: textTransform(restoreImportZoneFile),
  },
};

const hashObject = (type: "blob" | "tree", body: Buffer): Buffer =>
  NodeCrypto.createHash("sha1")
    .update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]))
    .digest();

/** The OID git gives a tree holding exactly these files. */
export const treeOid = (files: ReadonlyArray<TreeFile>): string => {
  interface Dir {
    readonly dirs: Map<string, Dir>;
    readonly files: Map<string, TreeFile>;
  }
  const root: Dir = { dirs: new Map(), files: new Map() };
  for (const file of files) {
    const parts = file.path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (next === undefined) {
        next = { dirs: new Map(), files: new Map() };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.set(parts.at(-1)!, file);
  }
  const hashDir = (dir: Dir): Buffer => {
    const entries = [
      ...[...dir.dirs].map(([name, child]) => ({
        name,
        sortKey: `${name}/`,
        mode: "40000",
        oid: hashDir(child),
      })),
      ...[...dir.files].map(([name, file]) => ({
        name,
        sortKey: name,
        mode: file.mode,
        oid: hashObject("blob", file.content),
      })),
    ].toSorted((a, b) => Buffer.compare(Buffer.from(a.sortKey), Buffer.from(b.sortKey)));
    return hashObject(
      "tree",
      Buffer.concat(
        entries.flatMap((entry) => [Buffer.from(`${entry.mode} ${entry.name}\0`), entry.oid]),
      ),
    );
  };
  return hashDir(root).toString("hex");
};

export interface Reproduction {
  /** The OID of the tree the inverse restores; upstream's when the path is `transform(upstream)`. */
  readonly restoredTree: string;
  /** Files whose restored content does not transform back to HEAD's bytes. */
  readonly notReproduced: ReadonlyArray<string>;
}

/** `files` are the tree of the imported path `zone`; a transform sees repository-relative paths. */
export const reproduce = (
  zone: string,
  files: ReadonlyArray<TreeFile>,
  transform: ImportTransform,
): Reproduction => {
  const restored = files.map((file) => ({
    ...file,
    content: transform.restore(`${zone}/${file.path}`, file.content),
  }));
  return {
    restoredTree: treeOid(restored),
    notReproduced: restored
      .filter(
        (file, index) =>
          !transform.apply(`${zone}/${file.path}`, file.content).equals(files[index]!.content),
      )
      .map((file) => file.path),
  };
};

/** Every file of `<ref>:<path>`, read with git ls-tree and one git cat-file --batch. */
export const readTreeFiles = (cwd: string, ref: string, path: string): ReadonlyArray<TreeFile> => {
  const listing = NodeChildProcess.execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--full-tree", ref, "--", path],
    { cwd, maxBuffer: 64 * 1024 * 1024 },
  )
    .toString("utf8")
    .split("\0")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [meta, fullPath] = line.split("\t") as [string, string];
      const [mode, type, oid] = meta.split(" ") as [string, string, string];
      return { mode, type, oid, path: fullPath.slice(path.length + 1) };
    });
  const submodule = listing.find((entry) => entry.type !== "blob");
  if (submodule !== undefined) {
    throw new Error(
      `${path}/${submodule.path} is a ${submodule.type}; only blobs can be restored.`,
    );
  }
  const batch = NodeChildProcess.execFileSync("git", ["cat-file", "--batch"], {
    cwd,
    input: listing.map((entry) => `${entry.oid}\n`).join(""),
    maxBuffer: 512 * 1024 * 1024,
  });
  let offset = 0;
  return listing.map((entry) => {
    const headerEnd = batch.indexOf(0x0a, offset);
    const size = Number(batch.subarray(offset, headerEnd).toString("utf8").split(" ")[2]);
    const content = batch.subarray(headerEnd + 1, headerEnd + 1 + size);
    offset = headerEnd + 1 + size + 1;
    return { path: entry.path, mode: entry.mode, content: Buffer.from(content) };
  });
};
