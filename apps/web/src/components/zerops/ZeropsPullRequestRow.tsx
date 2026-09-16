/**
 * A recipe change waiting on somebody — one open pull request on a group's
 * repo, at the end of the group's environment list.
 *
 * It sits there and not in a section of its own because it is the third thing
 * the group is made of (`groupRows.ts`): who you talk to, where the code runs,
 * and what is waiting to change what the code runs on. A pull request open
 * against the group repo is the only way an environment's shape moves, so it
 * belongs under the environments it would change.
 *
 * The same three places as `ZeropsEnvironmentRow`, so the eye runs one column
 * down the page: the title with its number as a tag, who opened it, and the
 * one verb — open it in Gitea. Structural: every word is the caller's (R5).
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";

export interface ZeropsPullRequestRowProps {
  readonly title: string;
  /** `#12 · ada` — who is waiting on whom, phrased by `pullRequestRow`. */
  readonly line: ReactNode;
  /** The one verb, when the caller has one — *Review*. */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function ZeropsPullRequestRow({
  title,
  line,
  action,
  className,
}: ZeropsPullRequestRowProps) {
  return (
    <li
      className={cn(
        "group/row grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] sm:py-0",
        className,
      )}
      data-zerops-pull-request-row="true"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className="min-w-0 truncate text-[13px] text-foreground"
          data-zerops-surface="pull-request-title"
        >
          {title}
        </span>
        <ZeropsRoleTag label="recipe" />
      </span>
      <span
        className="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1"
        data-zerops-surface="pull-request-line"
      >
        {line}
      </span>
      <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-end gap-3 sm:col-start-3">
        {action}
      </span>
    </li>
  );
}
