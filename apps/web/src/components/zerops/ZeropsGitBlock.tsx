/**
 * One code repository's history in the Git tab: what the Mate has actually done to the code.
 *
 * Where the work stands and where it goes are the tab's rows above (`ZeropsGitPanel`); this is
 * what sits under them. The **commits** this branch has that its base does not, which are the
 * Mate's actual work. And **what is on disk and not committed**, which lives in the container and
 * which nothing outside it can prove — the tab used to keep a count of that and throw the files
 * away.
 */
import type { GitBlock } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { SectionLabel } from "./system";

export interface ZeropsGitBlockProps {
  readonly block: GitBlock;
  /**
   * The commits on this branch that the base does not have — the Mate's own
   * work. Filled by the caller, which owns the read; a block stays pure.
   */
  readonly commits?: ReactNode;
  /** Says which repository it is, where the tab lists several. */
  readonly named?: boolean;
  readonly className?: string;
}

/** A list under the rows: what it is called, how many, and the rows themselves. */
function Detail({
  children,
  title,
  count,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly count: number;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <SectionLabel count={count} level={3}>
        {title}
      </SectionLabel>
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

export function ZeropsGitBlock({ block, commits, named = false, className }: ZeropsGitBlockProps) {
  const insertions = block.changed.reduce((total, file) => total + file.insertions, 0);
  const deletions = block.changed.reduce((total, file) => total + file.deletions, 0);
  const hasCommits = commits !== undefined && commits !== null;
  if (!hasCommits && block.changed.length === 0) return null;
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-zerops-surface="git-history"
    >
      {named ? <SectionLabel level={3}>{block.label ?? block.repository}</SectionLabel> : null}
      {hasCommits ? commits : null}

      {block.changed.length === 0 ? null : (
        <Detail count={block.changed.length} title="Not committed">
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
    </section>
  );
}
