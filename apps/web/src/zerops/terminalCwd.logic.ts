/**
 * Where a new terminal starts. A Mate's workspace (`/var/www`) is no Git repository of its own:
 * its code is in the checkouts zcp mounts below it, one per runtime service
 * (`/var/www/{hostname}`, `gitCheckoutHostnames`). So a Mate's terminal starts in its checkout —
 * the first, as the Git tab lists them, where it has several — and anything that says otherwise
 * wins: where the terminal was launched from, then a thread's own worktree.
 *
 * Pure: the checkouts arrive read, `undefined` while they are not (or off Zerops).
 */
import { ZEROPS_WORKSPACE_ROOT } from "./useZeropsGitRemoteProbe";

export function terminalStartCwd(input: {
  readonly launchCwd: string | null | undefined;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly checkouts: ReadonlyArray<string> | undefined;
}): string {
  if (input.launchCwd != null) return input.launchCwd;
  if (input.worktreePath !== null) return input.worktreePath;
  const first = input.checkouts?.[0];
  return input.workspaceRoot === ZEROPS_WORKSPACE_ROOT && first !== undefined
    ? `${ZEROPS_WORKSPACE_ROOT}/${first}`
    : input.workspaceRoot;
}
