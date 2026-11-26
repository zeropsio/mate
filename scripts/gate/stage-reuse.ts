// @effect-diagnostics nodeBuiltinImport:off -- host gate receipts fingerprint files on disk.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Fingerprint the current files and the immutable comparison-tree entries a stage reads. */
export function stageInputHash(
  root: string,
  paths: ReadonlyArray<string>,
  baseline: string,
): string {
  const hash = NodeCrypto.createHash("sha256");
  hash.update(baseline);
  for (const path of [...new Set(paths)].sort()) {
    const absolute = NodePath.join(root, path);
    const stat = NodeFS.lstatSync(absolute, { throwIfNoEntry: false });
    const bytes = !stat
      ? Buffer.alloc(0)
      : stat.isSymbolicLink()
        ? Buffer.from(NodeFS.readlinkSync(absolute))
        : NodeFS.readFileSync(absolute);
    hash.update(
      JSON.stringify([
        path,
        stat ? (stat.isSymbolicLink() ? "symlink" : "file") : "deleted",
        Boolean(stat && stat.mode & 0o111),
        bytes.length,
      ]),
    );
    hash.update(bytes);
  }
  return hash.digest("hex");
}

type PreviousReceipt = {
  readonly selectionHash: string;
  readonly stageHashes?: Readonly<Record<string, string>>;
  readonly selectedStages: ReadonlyArray<{ readonly name: string }>;
  readonly results: ReadonlyArray<{
    readonly name: string;
    readonly status: number;
    readonly durationMs: number;
  }>;
};

/** The guard's identified inputs replace the wider gate-selection hash for its receipt. */
export function canReuseStage(
  name: string,
  fingerprint: string | undefined,
  selection: string,
  previous: PreviousReceipt | undefined,
  guardIdentified: boolean,
): boolean {
  if (!previous || fingerprint === undefined) return false;
  return (
    (name === "guard ledgers" ? guardIdentified : previous.selectionHash === selection) &&
    previous.stageHashes?.[name] === fingerprint &&
    previous.selectedStages.some((stage) => stage.name === name) &&
    previous.results.some(
      (result) =>
        result.name === name &&
        result.status === 0 &&
        Number.isFinite(result.durationMs) &&
        result.durationMs >= 0,
    )
  );
}
