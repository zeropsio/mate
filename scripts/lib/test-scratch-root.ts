// @effect-diagnostics nodeBuiltinImport:off -- runs in the Vite config process, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Owned by mate-hq's `scripts/test-ramdisk.ts`, which creates and mounts the volume; z3 never does. */
export const TEST_RAMDISK_TMPDIR = "/Volumes/mate-test/tmp";

/** The volume's mount point, where mate-hq's tests keep their shared PostgreSQL home. */
const TEST_RAMDISK_ROOT = NodePath.dirname(TEST_RAMDISK_TMPDIR);

const writable = (directory: string): boolean => {
  try {
    NodeFS.accessSync(directory, NodeFS.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Uses an explicitly selected test directory, otherwise the writable RAM disk, so a run's
 * `os.tmpdir()` scratch stays off the indexed system disk. Without either, `TMPDIR` is left alone.
 * Called by the Vite configs, so every test worker inherits it.
 */
export function useTestScratchRoot(
  env: NodeJS.ProcessEnv,
  isWritable: (directory: string) => boolean = writable,
): void {
  if (env["MATE_TEST_TMPDIR"]) {
    env["TMPDIR"] = env["MATE_TEST_TMPDIR"];
    return;
  }
  if (isWritable(TEST_RAMDISK_TMPDIR)) env["TMPDIR"] = TEST_RAMDISK_TMPDIR;
}

/** The RAM disk's mount point when its temp root is present and writable, else undefined. */
export function testRamdiskRoot(
  isWritable: (directory: string) => boolean = writable,
): string | undefined {
  return isWritable(TEST_RAMDISK_TMPDIR) ? TEST_RAMDISK_ROOT : undefined;
}
