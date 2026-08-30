import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadLinkedPullRequest } from "@t3tools/contracts";

import { useEnvironmentQuery } from "./query";
import {
  presentThreadPr,
  type ThreadPrPresentation as LiveThreadPrPresentation,
} from "./thread-pr-presentation";
import { vcsEnvironment } from "./vcs";

export { presentThreadPr, type ThreadPr } from "./thread-pr-presentation";

export interface LinkedThreadPrPresentation {
  readonly number: number;
  readonly repository: string;
  readonly url: string;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly textClassName: string;
}

export type ThreadPrPresentation = LiveThreadPrPresentation | LinkedThreadPrPresentation;

export function presentLinkedThreadPr(
  linkedPullRequest: ThreadLinkedPullRequest,
): LinkedThreadPrPresentation {
  return {
    number: linkedPullRequest.number,
    repository: linkedPullRequest.repository,
    url: linkedPullRequest.url,
    label: String(linkedPullRequest.number),
    accessibilityLabel: `#${linkedPullRequest.number} pull request`,
    textClassName: "text-foreground-tertiary",
  };
}

/**
 * Live PR status for a thread's branch. Subscriptions are deduplicated per
 * (environmentId, cwd) by the atom family, so many rows on the same worktree
 * or project root share one stream — and virtualization means only visible
 * rows subscribe at all.
 */
export function useThreadPr(
  thread: EnvironmentThreadShell,
  projectCwd: string | null,
): ThreadPrPresentation | null {
  const cwd = thread.worktreePath ?? projectCwd;
  const gitStatus = useEnvironmentQuery(
    thread.linkedPullRequest == null && thread.branch !== null && cwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd },
        })
      : null,
  );
  if (thread.linkedPullRequest != null) {
    return presentLinkedThreadPr(thread.linkedPullRequest);
  }

  const status = gitStatus.data;
  if (status === null || thread.branch === null || status.refName !== thread.branch) {
    return null;
  }
  if (!status.pr) {
    return null;
  }
  return presentThreadPr(status.pr, status.sourceControlProvider);
}
