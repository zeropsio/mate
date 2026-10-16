/**
 * Where a new terminal starts. A Mate's workspace (`/var/www`) is no Git repository of its own:
 * its code is in the checkouts zcp mounts below it, one per runtime service
 * (`/var/www/{hostname}`, `gitCheckoutHostnames`). A service is listed before zcp mounts it, and
 * its mount can break or go with the service, so a terminal starts only in a checkout the Git tab
 * reads as an existing repository — the first, as it lists them — and in the workspace with none.
 * Anything that says otherwise wins: where the terminal was launched from, then a thread's own
 * worktree. The server still opens at the workspace should the folder go in between
 * (`startFolder`).
 *
 * Pure: the checkouts and what the disk says of each arrive read.
 */
import { checkoutPathFor, ZEROPS_WORKSPACE_ROOT } from "./useZeropsGitRemoteProbe";

/** The checkouts, in the Git tab's order, that the disk holds as Git repositories now. */
export function repositoriesOnDisk(
  hostnames: ReadonlyArray<string>,
  isRepository: (path: string) => boolean,
): ReadonlyArray<string> {
  return hostnames.filter((hostname) => isRepository(checkoutPathFor(hostname)));
}

export function terminalStartCwd(input: {
  readonly launchCwd: string | null | undefined;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  /** The Mate's checkouts that are repositories on disk (`repositoriesOnDisk`). */
  readonly repositories: ReadonlyArray<string>;
}): string {
  if (input.launchCwd != null) return input.launchCwd;
  if (input.worktreePath !== null) return input.worktreePath;
  const first = input.repositories[0];
  return input.workspaceRoot === ZEROPS_WORKSPACE_ROOT && first !== undefined
    ? checkoutPathFor(first)
    : input.workspaceRoot;
}
