/**
 * One code repository in the Git tab: where its work stands, what moves it,
 * and what the Mate has actually done to the code.
 *
 * The block used to open on `api · feature/invoices ↑0 ↓0` — the repository's
 * own name spent twice over, a branch named after a project id, and two zeros
 * that say exactly what no arrows at all would have said — and left the one
 * word a person came for in a data attribute nobody reads (the owner,
 * 2026-09-19: "this tab is pretty shit isn't it").
 *
 * So it is the anatomy every other surface opens with: the name, the facts
 * under it in one quiet line, then the answer in a panel whose edge is the
 * answer's colour, carrying the verb that acts on it.
 *
 * Under that: the **commits** this branch has that its base does not, which
 * are the Mate's actual work and the thing a person came to see. The **checks**
 * by name, because one collapsed word answers "can it land" and never "which
 * one broke". And **what is on disk and not committed**, which lives in the
 * container and which nothing outside it can prove — the tab used to keep a
 * count of that and throw the files away.
 *
 * The change's number opens the change's own page, not Gitea: that page is
 * where its conversation, its commits and its *Merge* are, and sending a
 * person to a forge they have to sign into for a change this app can already
 * draw is the long way round to a worse copy (the owner, 2026-09-19).
 *
 * Structural: every word is `gitTab.ts`'s (R5).
 */
import type { GitBlock } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { StatusDot, VerdictPanel } from "./primitives";

export interface ZeropsGitBlockProps {
  readonly block: GitBlock;
  /** The one verb, when the person may press it (`gitActionAllowed`). */
  readonly action?: ReactNode;
  /** Opens the change's own page. */
  readonly onOpenChange?: (() => void) | undefined;
  /**
   * The commits on this branch that the base does not have — the Mate's own
   * work. Filled by the caller, which owns the read; a block stays pure.
   */
  readonly commits?: ReactNode;
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
 * number is the way into its page and has to stay a control.
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

/** A list under the answer: what it is called, and the rows themselves. */
function Detail({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <ul className="flex min-w-0 flex-col">{children}</ul>
    </section>
  );
}

/** `+12 −1`, in the colours the rest of the client gives a gain and a loss. */
function DiffStat({
  deletions,
  insertions,
}: {
  readonly deletions: number;
  readonly insertions: number;
}) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      {insertions === 0 ? null : (
        <span className="text-[var(--zerops-status-ok-text)]">+{insertions}</span>
      )}
      {insertions === 0 || deletions === 0 ? null : " "}
      {deletions === 0 ? null : (
        <span className="text-[var(--zerops-status-failed-text)]">−{deletions}</span>
      )}
    </span>
  );
}

export function ZeropsGitBlock({
  block,
  action,
  commits,
  onOpenChange,
  className,
}: ZeropsGitBlockProps) {
  const insertions = block.changed.reduce((total, file) => total + file.insertions, 0);
  const deletions = block.changed.reduce((total, file) => total + file.deletions, 0);
  return (
    <li
      className={cn("flex min-w-0 flex-col gap-3", className)}
      data-zerops-git-block={block.repository}
      data-zerops-git-state={block.state}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{block.repository}</span>
          <Facts
            facts={[
              ...(block.pullRequestNumber === undefined
                ? []
                : [
                    {
                      id: "change",
                      node:
                        onOpenChange === undefined ? (
                          <span>#{block.pullRequestNumber}</span>
                        ) : (
                          <button
                            className="rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                            data-zerops-surface="git-change"
                            onClick={onOpenChange}
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
      </div>

      {commits === undefined || commits === null ? null : commits}

      {block.checkRows.length === 0 ? null : (
        <Detail title="Checks">
          {block.checkRows.map((check) => (
            <li
              className="flex min-w-0 items-center justify-between gap-3 py-1 text-xs"
              data-zerops-surface="git-check"
              key={check.name}
            >
              <span className="min-w-0 truncate font-mono text-foreground">{check.name}</span>
              <StatusDot className="shrink-0" label={check.word} tone={check.tone} />
            </li>
          ))}
        </Detail>
      )}

      {block.changed.length === 0 ? null : (
        <Detail title={`Not committed · ${String(block.changed.length)}`}>
          {block.changed.map((file) => (
            <li
              className="flex min-w-0 items-center justify-between gap-3 py-1 text-xs"
              data-zerops-surface="git-changed-file"
              key={file.path}
            >
              <span className="min-w-0 truncate font-mono text-foreground">{file.path}</span>
              <DiffStat deletions={file.deletions} insertions={file.insertions} />
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
            <span>In total</span>
            <DiffStat deletions={deletions} insertions={insertions} />
          </li>
        </Detail>
      )}
    </li>
  );
}
