/**
 * A change waiting on somebody — one open pull request of a project, in the
 * list its environments are in.
 *
 * Two kinds sit here (`projectFlow.ts`): a Mate's code change, at the head
 * of the list because it is what is waiting to reach the stage, and a recipe
 * change at its end, because a pull request against the group repo is the
 * only way an environment's shape moves and it belongs under the
 * environments it would change. The tag says which.
 *
 * The same three places as `ZeropsEnvironmentRow`, so the eye runs one column
 * down the page: the title with its kind as a tag, who and where in one
 * line, and at the end the checks as a dot and the one verb — *Merge* where
 * Gitea allows it. The title is the way into Gitea when the caller gives a
 * URL. Structural: every word is the caller's (R5).
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";

export interface ZeropsPullRequestRowProps {
  readonly title: string;
  /** The pull request's page in Gitea; with it the title is a link. */
  readonly url?: string | undefined;
  /** What kind of change it is — `recipe` by default, `pr` for a code change. */
  readonly tag?: string;
  /** `appdev #4 · Vera` — where and whose, phrased by `projectFlow.ts`. */
  readonly line: ReactNode;
  /** A `StatusDot` for the checks, when any ran. */
  readonly status?: ReactNode;
  /** The one verb, when the caller has one — *Merge*, *Review*. */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function ZeropsPullRequestRow({
  title,
  url,
  tag = "recipe",
  line,
  status,
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
        {url === undefined ? (
          <span
            className="min-w-0 truncate text-[13px] text-foreground"
            data-zerops-surface="pull-request-title"
          >
            {title}
          </span>
        ) : (
          <a
            className="min-w-0 truncate rounded-sm text-[13px] text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-zerops-surface="pull-request-title"
            href={url}
            rel="noopener"
            target="_blank"
          >
            {title}
          </a>
        )}
        <ZeropsRoleTag label={tag} />
      </span>
      <span
        className="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1"
        data-zerops-surface="pull-request-line"
      >
        {line}
      </span>
      <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-end gap-3 sm:col-start-3">
        {status}
        {action}
      </span>
    </li>
  );
}
