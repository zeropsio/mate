/**
 * The Git tab — the fourth right-panel surface, beside Diff, Browser and Data.
 *
 * This Mate's leg of the project's flow, and nothing else (D26): one block
 * per code repository, the branch the container is on and where that branch
 * goes — the pull request open from it, how its checks went, which
 * environment picks it up on merge — and at most one verb. The rest of the
 * flow is not here: what the project's stage and production run, its
 * releases and its recipe changes are the project's, shown in the left menu
 * under the project and on the projects screen, where every Mate's share of
 * them sits together. A tab that carried them read as "git for the whole
 * project" in a Mate's own panel (the owner, 2026-09-17).
 *
 * Every fact comes from the party that can prove it, and each one arrives on
 * its own schedule: the checkout is a live subscription, and the Gitea side is
 * re-read when the tab opens, after each action, and every sixty seconds while
 * it is open. Nothing here decides anything — `gitTab.ts` does, and this
 * renders what it produced (R5).
 *
 * Signed out of Gitea, the checkout half still works: the container is the
 * Mate server's to stream and needs no forge. The forge half says so in one
 * line rather than showing a block that looks like a branch nobody has asked
 * about.
 */
import type { GitBlock } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";
import { ZeropsGitBlock } from "./ZeropsGitBlock";
import { MicroLabel } from "./primitives";

export interface ZeropsGitPanelModel {
  /** Whether this tab holds a Gitea session; without one only the checkout half can speak. */
  readonly signedIn: boolean;
  /**
   * Why the sign-in did not go through, when the broker or Gitea refused it
   * (a login source that does not exist, an account Gitea will not make).
   * Shown in place of "Signing you in to Gitea…"; a Gitea still setting up
   * is not a refusal and keeps the line.
   */
  readonly signInTrouble?: string | undefined;
  readonly blocks: ReadonlyArray<GitBlock>;
}

function Section({
  label,
  children,
  hint,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string;
}) {
  return (
    <section className="flex flex-col gap-1" data-zerops-git-section={label}>
      <MicroLabel>{label}</MicroLabel>
      {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
      {children}
    </section>
  );
}

export interface ZeropsGitPanelProps {
  readonly model: ZeropsGitPanelModel;
  /** The verb under a repository's block — already gated (`gitActionAllowed`). */
  readonly renderBlockAction?: (block: GitBlock) => ReactNode;
  readonly onOpenPullRequest?: (block: GitBlock) => void;
  readonly className?: string;
}

export function ZeropsGitPanel({
  model,
  renderBlockAction,
  onOpenPullRequest,
  className,
}: ZeropsGitPanelProps) {
  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)}>
      <div className="flex flex-col gap-6 px-4 py-4" data-zerops-surface="git-panel">
        <Section label="Repositories">
          {model.blocks.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No code repository yet. The first service brings one.
            </span>
          ) : (
            <ul className="flex flex-col divide-y divide-border/50">
              {model.blocks.map((block) => (
                <ZeropsGitBlock
                  action={renderBlockAction?.(block)}
                  block={block}
                  key={block.repository}
                  onOpenPullRequest={
                    block.pullRequestNumber === undefined || onOpenPullRequest === undefined
                      ? undefined
                      : () => onOpenPullRequest(block)
                  }
                />
              ))}
            </ul>
          )}
        </Section>

        {model.signedIn ? null : (
          <Section label="Gitea">
            {model.signInTrouble === undefined ? (
              <span className="text-xs text-muted-foreground">Signing you in to Gitea…</span>
            ) : (
              <span
                className="text-xs text-[var(--zerops-status-failed)]"
                data-zerops-surface="git-signin-trouble"
              >
                {model.signInTrouble}
              </span>
            )}
          </Section>
        )}
      </div>
    </ScrollArea>
  );
}
