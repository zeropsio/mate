/**
 * One environment on the projects screen — a Zerops project that is not a
 * Mate's: stage, production, a dev box nobody has set a Mate up in.
 *
 * A row of a list with three places, the same three down the page so the
 * eye can run a column: the name with its role trailing it as a pill; what
 * the environment holds, in one muted line — its services and when code last
 * landed, or that there is nothing in it yet; and at the end only what is
 * worth saying when there is something — a word about the project when it is
 * not simply there (creating, stopped), the one verb ("Set up Mate", on a dev
 * environment), and the menu, where the environment's public access and its
 * quieter actions live. On a phone the line about what it holds drops under
 * the name.
 *
 * Structural: every word about state, the summary and every verb are the
 * caller's (R5).
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { MicroLabel } from "./primitives";

/**
 * A tag as a pill: the environment's role, as the tag reads — DEV, STAGE,
 * PROD — trailing its name, here and in the left menu's fold.
 */
export function ZeropsRoleTag({
  label,
  className,
}: {
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-full border border-border/70 px-1.5",
        className,
      )}
      data-zerops-surface="role-tag"
    >
      <MicroLabel className="leading-none">{label}</MicroLabel>
    </span>
  );
}

export interface ZeropsEnvironmentRowProps {
  /** The Zerops project — what the Zerops GUI calls it. */
  readonly name: string;
  /** The role as its tag reads (`dev`, `stage`, `prod`), or nothing for an environment with no role. */
  readonly tag: string | null;
  /**
   * What the environment holds, in one line: `app, db · deployed 2h ago`,
   * or "No services yet". Absent while the services are unread.
   */
  readonly summary?: ReactNode;
  /** A `StatusDot` when the project is not simply there: creating, stopped. */
  readonly status?: ReactNode;
  /** The one verb — a `ZeropsMateVerb` — when there is one. */
  readonly action?: ReactNode;
  readonly menu?: ReactNode;
  readonly busy?: boolean;
  readonly className?: string;
}

export function ZeropsEnvironmentRow({
  name,
  tag,
  summary,
  status,
  action,
  menu,
  busy = false,
  className,
}: ZeropsEnvironmentRowProps) {
  return (
    <li
      aria-busy={busy || undefined}
      className={cn(
        "group/row grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] sm:py-0",
        className,
      )}
      data-zerops-environment-row="true"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className="min-w-0 truncate text-[13px] text-foreground"
          data-zerops-surface="environment-name"
        >
          {name}
        </span>
        {tag === null ? null : <ZeropsRoleTag label={tag} />}
      </span>
      <span
        className="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1"
        data-zerops-surface="environment-summary"
      >
        {summary}
      </span>
      <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-end gap-3 sm:col-start-3">
        {status}
        {action}
        {menu === undefined || menu === null ? null : (
          <span className="flex opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            {menu}
          </span>
        )}
      </span>
    </li>
  );
}
