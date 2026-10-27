/**
 * Where a new terminal starts. A Mate's workspace (`/var/www`) is no Git repository of its own:
 * its code is in the checkouts zcp mounts below it, one per runtime service
 * (`/var/www/{hostname}`, `gitCheckoutHostnames`). A service is listed before zcp mounts it, and
 * its mount can break or go with the service, so a terminal starts only in a checkout the Git tab
 * reads as an existing repository — the first, as it lists them — and in the workspace with none.
 * Anything that says otherwise wins: where the terminal was launched from, then the pool container
 * the thread's agent leased (`/var/www/{alias}`), then a thread's own worktree. The server still
 * opens at the workspace should the folder go in between (`startFolder`).
 *
 * Pure: the checkouts and what the disk says of each arrive read.
 */
import { checkoutPathFor, ZEROPS_WORKSPACE_ROOT } from "./useZeropsGitRemoteProbe";

/**
 * The checkouts, in the Git tab's order, that the disk holds as Git repositories now; `null` while
 * any checkout's read has not answered (`isRepository` says `null`).
 */
export function repositoriesOnDisk(
  hostnames: ReadonlyArray<string>,
  isRepository: (path: string) => boolean | null,
): ReadonlyArray<string> | null {
  const read = hostnames.map((hostname) => isRepository(checkoutPathFor(hostname)));
  if (read.includes(null)) return null;
  return hostnames.filter((_, index) => read[index] === true);
}

/**
 * The folder, or `null` while a Mate's checkouts are still read: a shell opened in the bare
 * workspace stays there, outside the code (the onboarding run, 2026-10-16: "→ www").
 */
export function terminalStartCwd(input: {
  readonly launchCwd: string | null | undefined;
  readonly workspaceRoot: string;
  /** The alias of the lease the thread is bound to; null: none. */
  readonly lease: string | null;
  readonly worktreePath: string | null;
  /** The Mate's checkouts that are repositories on disk (`repositoriesOnDisk`); `null` unread. */
  readonly repositories: ReadonlyArray<string> | null;
}): string | null {
  if (input.launchCwd != null) return input.launchCwd;
  if (input.lease !== null) return checkoutPathFor(input.lease);
  if (input.worktreePath !== null) return input.worktreePath;
  if (input.workspaceRoot !== ZEROPS_WORKSPACE_ROOT) return input.workspaceRoot;
  if (input.repositories === null) return null;
  const first = input.repositories[0];
  return first === undefined ? input.workspaceRoot : checkoutPathFor(first);
}
