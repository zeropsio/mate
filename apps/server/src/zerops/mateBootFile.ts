// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** What a boot that has not reached command readiness reports of itself. */
export interface MateBootReceipt {
  /** Units of boot work done so far; it only grows within a boot. */
  readonly progress: number;
  /** Why startup failed, once it has. */
  readonly error?: string;
}

/**
 * The boot's receipt in the file zcp names (`ZCP_MATE_BOOT_FILE`, zcp `docs/spec-mate.md` §2.1d),
 * replaced whole in one rename so zcp never reads half of one. It is written synchronously, at the
 * step itself: the HTTP server answers nothing until startup completes, and a boot folding a long
 * history leaves the event loop no turn in which another writer could run. zcp removes the file
 * before each restart it requests, and the process id tells this boot from a later one.
 * A write that fails is only a receipt missing.
 */
export function writeMateBootFile(at: string, receipt: MateBootReceipt): void {
  const staged = NodePath.join(NodePath.dirname(at), `.${NodePath.basename(at)}.next`);
  try {
    NodeFS.writeFileSync(staged, JSON.stringify({ protocol: 1, pid: process.pid, ...receipt }), {
      mode: 0o600,
    });
    NodeFS.renameSync(staged, at);
  } catch {
    NodeFS.rmSync(staged, { force: true });
  }
}
