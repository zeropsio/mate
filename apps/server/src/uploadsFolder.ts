// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/**
 * The Mate's uploads folder: every file a person sends, kept under its own
 * name where they and the agent find it. The stored attachment stays the
 * conversation's; the folder holds a hard link to it, or a copy where a link
 * cannot be made, so the agent may move or remove its file freely.
 */

const STEM_MAX_CHARS = 200;

/** A sent file's name as a plain file in the folder: no folders, no hidden dot. */
export function uploadsFileName(name: string): string {
  const base = (name.split(/[\\/]/u).pop() ?? "")
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .replace(/^\.+/u, "");
  if (base.length === 0) return "file";
  const extension = NodePath.extname(base);
  const stem = base.slice(0, base.length - extension.length);
  return `${stem.slice(0, STEM_MAX_CHARS)}${extension}`;
}

function sameFile(path: string, stored: NodeFS.Stats): boolean | null {
  try {
    const stats = NodeFS.statSync(path);
    return stats.ino === stored.ino && stats.dev === stored.dev;
  } catch {
    return null;
  }
}

/**
 * Where the agent is told an attachment is: a sent file in the uploads folder
 * (spec.pdf, then spec-2.pdf for another file of that name, the same place
 * again for the same file), anything else where it is stored.
 */
export function agentAttachmentPath(input: {
  readonly uploadsDir: string;
  readonly attachment: {
    readonly type: string;
    readonly name: string;
    readonly source?: { readonly _tag: string } | undefined;
  };
  readonly storedPath: string;
}): string {
  const { attachment, storedPath, uploadsDir } = input;
  if (attachment.type !== "file" || attachment.source?._tag === "pasted-text") return storedPath;
  try {
    const stored = NodeFS.statSync(storedPath);
    NodeFS.mkdirSync(uploadsDir, { recursive: true });
    const name = uploadsFileName(attachment.name);
    const extension = NodePath.extname(name);
    const stem = name.slice(0, name.length - extension.length);
    for (let n = 1; ; n += 1) {
      const candidate = NodePath.join(uploadsDir, n === 1 ? name : `${stem}-${n}${extension}`);
      const same = sameFile(candidate, stored);
      if (same === true) return candidate;
      if (same === false) continue;
      try {
        NodeFS.linkSync(storedPath, candidate);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") continue;
        NodeFS.copyFileSync(storedPath, candidate, NodeFS.constants.COPYFILE_EXCL);
      }
      return candidate;
    }
  } catch {
    return storedPath;
  }
}
