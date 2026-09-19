/**
 * One code repository in the Git tab: where its work stands, and what moves it.
 *
 * The block used to open on `api · feature/invoices ↑0 ↓0` — the repository's
 * own name spent twice over, a machine-generated branch name, and two zeros
 * that say exactly what no arrows at all would have said — and left the one
 * word a person came for in a data attribute nobody reads (the owner,
 * 2026-09-19: "this tab is pretty shit isn't it").
 *
 * So it is the anatomy every other surface opens with: the name, the facts
 * under it in one quiet line, and then the answer in a panel whose edge is the
 * answer's colour, carrying the verb that acts on it. The order is the order a
 * person reads in — which repository, what about it, what now.
 *
 * Structural: every word is `gitTab.ts`'s (R5), including the sentence, which
 * a test and a harness can read in every state without a forge behind them.
 */
import type { GitBlock } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { VerdictPanel } from "./primitives";

export interface ZeropsGitBlockProps {
  readonly block: GitBlock;
  /** The one verb, when the person may press it (`gitActionAllowed`). */
  readonly action?: ReactNode;
  /** Opens the pull request in Gitea. */
  readonly onOpenPullRequest?: (() => void) | undefined;
  readonly className?: string;
}

/** One fact under the name, keyed by what it is rather than by where it sits. */
interface Fact {
  readonly id: string;
  readonly node: ReactNode;
}

/**
 * The facts under the name, separated the way the rest of the client separates
 * them. Built from nodes rather than from a joined string because the change's
 * number is the way into Gitea and has to stay a control.
 */
function Facts({ facts }: { readonly facts: ReadonlyArray<Fact> }) {
  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
      data-zerops-surface="git-facts"
    >
      {facts.map((fact, index) => (
        <span className="contents" key={fact.id}>
          {index === 0 ? null : <span aria-hidden="true">·</span>}
          {fact.node}
        </span>
      ))}
    </span>
  );
}

export function ZeropsGitBlock({
  block,
  action,
  onOpenPullRequest,
  className,
}: ZeropsGitBlockProps) {
  return (
    <li
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      data-zerops-git-block={block.repository}
      data-zerops-git-state={block.state}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{block.repository}</span>
        <Facts
          facts={[
            ...(block.pullRequestNumber === undefined
              ? []
              : [
                  {
                    id: "pull-request",
                    node:
                      onOpenPullRequest === undefined ? (
                        <span>#{block.pullRequestNumber}</span>
                      ) : (
                        <button
                          className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          data-zerops-surface="git-pull-request"
                          onClick={onOpenPullRequest}
                          type="button"
                        >
                          #{block.pullRequestNumber}
                        </button>
                      ),
                  },
                ]),
            {
              id: "checkout",
              node: <span className="min-w-0 truncate">{block.checkoutLine}</span>,
            },
            ...(block.destination.length === 0
              ? []
              : [
                  {
                    id: "destination",
                    node: <span className="min-w-0 truncate">{block.destination}</span>,
                  },
                ]),
          ]}
        />
      </div>
      <VerdictPanel text={block.verdict.text} tone={block.verdict.tone}>
        {action === undefined || action === null ? undefined : action}
      </VerdictPanel>
    </li>
  );
}
