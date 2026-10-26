// @effect-diagnostics nodeBuiltinImport:off -- host gate runner.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const installedLockfile = "node_modules/.pnpm/lock.yaml";

function readIfPresent(path: string): Buffer | undefined {
  try {
    return NodeFS.readFileSync(path);
  } catch {
    return undefined;
  }
}

/**
 * pnpm copies the lockfile it installed from to `node_modules/.pnpm/lock.yaml`; patch content
 * hashes live in that file's `patchedDependencies`. A byte difference from `pnpm-lock.yaml`
 * means the install is for another commit (a merge changed the lockfile or a patch).
 * Returns the refusal text, or undefined when the install matches (or there is no lockfile to compare).
 */
export function staleDependencies(root: string): string | undefined {
  const wanted = readIfPresent(NodePath.join(root, "pnpm-lock.yaml"));
  if (!wanted) return undefined;
  const installed = readIfPresent(NodePath.join(root, installedLockfile));
  if (!installed) return "dependencies are not installed in this worktree; run `vp i`.";
  return installed.equals(wanted)
    ? undefined
    : "installed dependencies do not match pnpm-lock.yaml (a lockfile or patch changed since the last install); run `vp i`.";
}
