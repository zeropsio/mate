/**
 * What is on disk and not committed in one code repository, as a section of its card in the Git
 * tab: it lives in the container and nothing outside it can prove it — the tab used to keep a count
 * of that and throw the files away. The commits are the card's own fold (`GitCommitsFold`).
 */
import type { GitBlock } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { SectionLabel } from "./system";

export interface ZeropsGitBlockProps {
  readonly block: GitBlock;
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

export function ZeropsGitBlock({ block, className }: ZeropsGitBlockProps) {
  const insertions = block.changed.reduce((total, file) => total + file.insertions, 0);
  const deletions = block.changed.reduce((total, file) => total + file.deletions, 0);
  if (block.changed.length === 0) return null;
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-2", className)}
      data-zerops-surface="git-history"
    >
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
