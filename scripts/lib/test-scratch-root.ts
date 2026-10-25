// @effect-diagnostics nodeBuiltinImport:off -- runs in the Vite config process, outside any Effect runtime.
import * as NodeFS from "node:fs";

/** Owned by mate-hq's `scripts/test-ramdisk.ts`, which creates and mounts the volume; z3 never does. */
export const TEST_RAMDISK_TMPDIR = "/Volumes/mate-test/tmp";

const writable = (directory: string): boolean => {
  try {
    NodeFS.accessSync(directory, NodeFS.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Points `TMPDIR` at the RAM disk when its temp root is present and writable, so a run's
 * `os.tmpdir()` scratch stays off the indexed system disk. Absent (CI, Linux, other machines),
 * `TMPDIR` is left alone. Called by the Vite configs, so every test worker inherits it.
 */
export function useTestScratchRoot(
  env: NodeJS.ProcessEnv,
  isWritable: (directory: string) => boolean = writable,
): void {
  if (isWritable(TEST_RAMDISK_TMPDIR)) env["TMPDIR"] = TEST_RAMDISK_TMPDIR;
}
