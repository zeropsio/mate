// @effect-diagnostics nodeBuiltinImport:off -- runs in the Vite config process, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Owned by mate-hq's `scripts/test-ramdisk.ts`, which creates and mounts the volume; z3 never does. */
export const TEST_RAMDISK_TMPDIR = "/Volumes/mate-test/tmp";

/** The volume's mount point, where mate-hq's tests keep their shared PostgreSQL home. */
const TEST_RAMDISK_ROOT = NodePath.dirname(TEST_RAMDISK_TMPDIR);

/**
 * The file a z3 test process writes into its own scratch directory: the PID whose exit frees the
 * directory. Only a directory carrying it is ever reclaimed; a name alone proves no ownership.
 */
export const SCRATCH_OWNER_FILE = "mate-test-owner";

const writable = (directory: string): boolean => {
  try {
    NodeFS.accessSync(directory, NodeFS.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Whether a scratch directory with this owner record (undefined: none) is orphaned: its owner
 * process is gone. A directory without a record, or with one that names no PID, is never judged.
 */
export function scratchOrphaned(
  record: string | undefined,
  alive: (pid: number) => boolean,
): boolean {
  if (record === undefined) return false;
  const pid = Number(record.trim());
  return Number.isInteger(pid) && pid > 0 && !alive(pid);
}

const ownerRecord = (directory: string): string | undefined => {
  try {
    return NodeFS.readFileSync(NodePath.join(directory, SCRATCH_OWNER_FILE), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
};

/**
 * Removes `directory`'s contents before its owner record, so a removal killed halfway leaves a
 * directory the next reclaim still recognises and finishes. Runs that start together may reclaim
 * the same directory; the one that finds it gone has nothing left to do.
 */
function removeScratch(directory: string): void {
  let entries: string[];
  try {
    entries = NodeFS.readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry === SCRATCH_OWNER_FILE) continue;
    NodeFS.rmSync(NodePath.join(directory, entry), { recursive: true, force: true, maxRetries: 3 });
  }
  NodeFS.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Removes the scratch directories under `root` whose owner process is gone: runs killed before
 * their exit hook could remove their own. Returns the removed paths; everything else stays.
 */
export function reclaimOrphanedScratch(
  root: string,
  alive: (pid: number) => boolean = pidAlive,
): ReadonlyArray<string> {
  const removed: string[] = [];
  for (const name of NodeFS.readdirSync(root)) {
    const directory = NodePath.join(root, name);
    if (!scratchOrphaned(ownerRecord(directory), alive)) continue;
    removeScratch(directory);
    removed.push(directory);
  }
  return removed;
}

export interface ScratchHost {
  readonly root: string;
  readonly pid: number;
  readonly isWritable: (directory: string) => boolean;
  readonly alive: (pid: number) => boolean;
  readonly onExit: (remove: () => void) => void;
}

const host: ScratchHost = {
  root: TEST_RAMDISK_TMPDIR,
  pid: process.pid,
  isWritable: writable,
  alive: pidAlive,
  onExit: (remove) => process.once("exit", remove),
};

/**
 * Uses an explicitly selected test directory, otherwise this process's own scratch directory on
 * the writable RAM disk, so a run's `os.tmpdir()` scratch stays off the indexed system disk and
 * leaves with the process. Orphaned directories of earlier runs are reclaimed first. Without
 * either, `TMPDIR` is left alone. Called by the Vite configs, so every test worker inherits it; a
 * config that loads again in the same process keeps the directory it already made.
 */
export function useTestScratchRoot(
  env: NodeJS.ProcessEnv,
  overrides: Partial<ScratchHost> = {},
): void {
  if (env["MATE_TEST_TMPDIR"]) {
    env["TMPDIR"] = env["MATE_TEST_TMPDIR"];
    return;
  }
  const { root, pid, isWritable, alive, onExit } = { ...host, ...overrides };
  if (!isWritable(root)) return;
  const current = env["TMPDIR"];
  if (
    current !== undefined &&
    NodePath.dirname(current) === root &&
    ownerRecord(current) === String(pid)
  )
    return;
  reclaimOrphanedScratch(root, alive);
  const run = NodeFS.mkdtempSync(NodePath.join(root, `z3-run-${pid}-`));
  NodeFS.writeFileSync(NodePath.join(run, SCRATCH_OWNER_FILE), String(pid));
  onExit(() => removeScratch(run));
  env["TMPDIR"] = run;
}

/** The RAM disk's mount point when its temp root is present and writable, else undefined. */
export function testRamdiskRoot(
  isWritable: (directory: string) => boolean = writable,
): string | undefined {
  return isWritable(TEST_RAMDISK_TMPDIR) ? TEST_RAMDISK_ROOT : undefined;
}
