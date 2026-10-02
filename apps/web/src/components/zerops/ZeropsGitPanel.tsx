/**
 * The Git tab — the fourth right-panel surface, beside Diff, Browser and Data.
 *
 * This Mate's leg of the project's flow, and nothing else (D26): one block
 * per code repository — its name, the branch the container is on and where
 * that branch goes, then where its work stands and the one verb that moves
 * it. The rest of the flow is not here: what the project's stage and
 * production run, its releases and its recipe changes are the project's,
 * shown in the left menu under the project and on the projects screen, where
 * every Mate's share of them sits together. A tab that carried them read as
 * "git for the whole project" in a Mate's own panel (the owner, 2026-09-17).
 *
 * Every fact comes from the party that can prove it, and each one arrives on
 * its own schedule: the checkout is a live subscription, and the Mate's change
 * comes down HQ's stream. Nothing here decides anything — `gitTab.ts` does, and
 * this renders what it produced (R5).
 */
import type { GitBlock } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { ZeropsGitBlock } from "./ZeropsGitBlock";

export interface ZeropsGitPanelModel {
  readonly blocks: ReadonlyArray<GitBlock>;
}

export interface ZeropsGitPanelProps {
  readonly model: ZeropsGitPanelModel;
  /** The verb under a repository's block — already gated (`gitActionAllowed`). */
  readonly renderBlockAction?: (block: GitBlock) => ReactNode;
  /** Opens a block's change on its own page. */
  readonly onOpenChange?: (block: GitBlock) => void;
  /** The commits on a block's branch — read by the caller, drawn by the block. */
  readonly renderBlockCommits?: (block: GitBlock) => ReactNode;
  readonly className?: string;
}

export function ZeropsGitPanel({
  model,
  renderBlockAction,
  renderBlockCommits,
  onOpenChange,
  className,
}: ZeropsGitPanelProps) {
  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)}>
      <div className="flex flex-col gap-5 px-4 py-4" data-zerops-surface="git-panel">
        {/* No "Repositories" label over them: each block says its own name, and
            a heading for a list of one is a line that repeats the tab. */}
        {model.blocks.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            No code repository yet. The first service brings one.
          </span>
        ) : (
          <ul className="flex flex-col gap-5">
            {model.blocks.map((block) => (
              <ZeropsGitBlock
                action={renderBlockAction?.(block)}
                block={block}
                commits={renderBlockCommits?.(block)}
                key={block.repository}
                onOpenChange={
                  block.pullRequestNumber === undefined || onOpenChange === undefined
                    ? undefined
                    : () => onOpenChange(block)
                }
              />
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  );
}
