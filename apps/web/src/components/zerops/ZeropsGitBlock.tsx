/**
 * One code repository in the Git tab: where the work is, and where it goes.
 *
 * Two lines, always the same two, whatever has answered (guide 4.5). The first
 * is the checkout — `api · feature/invoices ↑3 ↓0 · 2 files changed` — which
 * the container streams and nobody else can say. The second is where that
 * branch goes: the pull request open from it, how its checks went, and which
 * environment picks it up. At the end, at most one verb.
 *
 * The branch is a name, not a status. The checks are a `StatusDot` and one
 * word, never a sentence (R5). And where a fact has been *proved* wrong — no
 * Gitea access, a remote that did not answer — that is what the block says,
 * instead of a green line about a setup that cannot push.
 *
 * Structural: every word is `gitTab.ts`'s (R5).
 */
import type { GitBlock } from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { StatusDot } from "./primitives";

/** The checks' tone as a dot's; `undefined` where no check ran and no dot belongs. */
export function checkDotTone(block: GitBlock): ServiceStatusToneId | undefined {
  switch (block.checks) {
    case "passing":
      return "ok";
    case "pending":
      return "busy";
    case "failing":
      return "failed";
    case "none":
      return undefined;
  }
}

export interface ZeropsGitBlockProps {
  readonly block: GitBlock;
  /** The one verb, when the person may press it (`gitActionAllowed`). */
  readonly action?: ReactNode;
  /** Opens the pull request in Gitea. */
  readonly onOpenPullRequest?: (() => void) | undefined;
  readonly className?: string;
}

export function ZeropsGitBlock({
  block,
  action,
  onOpenPullRequest,
  className,
}: ZeropsGitBlockProps) {
  const tone = checkDotTone(block);
  return (
    <li
      className={cn("flex min-w-0 flex-col gap-0.5 py-2", className)}
      data-zerops-git-block={block.repository}
      data-zerops-git-state={block.state}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="min-w-0 flex-1 truncate text-[13px] text-foreground"
          data-zerops-surface="git-head"
        >
          {block.headLine}
        </span>
        {action === undefined || action === null ? null : (
          <span className="shrink-0">{action}</span>
        )}
      </div>
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
        data-zerops-surface="git-destination"
      >
        {block.pullRequestNumber === undefined ? null : onOpenPullRequest === undefined ? (
          <span>PR #{block.pullRequestNumber}</span>
        ) : (
          <button
            className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-zerops-surface="git-pull-request"
            onClick={onOpenPullRequest}
            type="button"
          >
            PR #{block.pullRequestNumber}
          </button>
        )}
        {tone === undefined || block.checkWord === undefined ? null : (
          <StatusDot label={block.checkWord} tone={tone} />
        )}
        {block.destination.length === 0 ? null : (
          <span className="min-w-0 truncate">{block.destination}</span>
        )}
        {block.trouble.length === 0 ? null : (
          <span
            className="min-w-0 truncate text-[var(--zerops-status-failed-text)]"
            data-zerops-surface="git-trouble"
          >
            {block.trouble}
          </span>
        )}
      </div>
    </li>
  );
}
