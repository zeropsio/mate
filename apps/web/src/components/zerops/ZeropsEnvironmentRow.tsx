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
import type { ZeropsEnvironmentRole } from "@t3tools/client-runtime/zerops";
import { Link } from "@tanstack/react-router";
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

/** A stage or a production of a group: the stop page's address. */
export interface ZeropsStopLink {
  readonly groupId: string;
  readonly projectId: string;
}

/**
 * Where an environment's name leads: a group's stage or production opens
 * its stop page; anything else — a dev box, a project no group holds — has
 * no page of its own.
 */
export function stopLinkOf(
  groupId: string | undefined,
  projectId: string,
  role: ZeropsEnvironmentRole | undefined,
): ZeropsStopLink | undefined {
  if (groupId === undefined || (role !== "prod" && role !== "stage")) return undefined;
  return { groupId, projectId };
}

/**
 * The way into a stop's page from a thing on the projects page that names
 * it: no underline at rest, one on hover, the ring on focus.
 */
export const STOP_LINK_CLASS =
  "rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

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
  /** A stop's row: its name opens the stop's page. */
  readonly link?: ZeropsStopLink | undefined;
  readonly busy?: boolean;
  readonly className?: string;
  /** Drawn before the name, in its cell — a release's chevron, or the space one takes. */
  readonly leading?: ReactNode;
  /** A second, muted line under the summary, which then reads in the foreground. */
  readonly summaryDetail?: ReactNode;
  /** What the row opens onto, under all three places. */
  readonly expansion?: ReactNode;
}

/**
 * The row's three places as a grid — name, what it holds, the trailing end —
 * for any line that should run down the same columns (the projects page's
 * tools line). The end has a floor wide enough for a verb and the menu, so a
 * row without them starts its columns where one with them does.
 */
export const ENVIRONMENT_ROW_GRID_CLASS =
  "grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(9.5rem,auto)] sm:py-0";

export function ZeropsEnvironmentRow({
  name,
  tag,
  summary,
  status,
  action,
  menu,
  link,
  busy = false,
  className,
  leading,
  summaryDetail,
  expansion,
}: ZeropsEnvironmentRowProps) {
  const nameClass = "min-w-0 truncate text-sm text-foreground";
  return (
    <li
      aria-busy={busy || undefined}
      className={cn("group/row", ENVIRONMENT_ROW_GRID_CLASS, className)}
      data-zerops-environment-row="true"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {leading}
        {link === undefined ? (
          <span className={nameClass} data-zerops-surface="environment-name">
            {name}
          </span>
        ) : (
          <Link
            className={cn(nameClass, STOP_LINK_CLASS)}
            data-zerops-surface="environment-name"
            params={link}
            to="/group/$groupId/$projectId"
          >
            {name}
          </Link>
        )}
        {tag === null ? null : <ZeropsRoleTag label={tag} />}
      </span>
      {summaryDetail === undefined ? (
        <span
          className="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1"
          data-zerops-surface="environment-summary"
        >
          {summary}
        </span>
      ) : (
        <span
          className="col-span-2 flex min-w-0 flex-col text-xs sm:col-span-1"
          data-zerops-surface="environment-summary"
        >
          <span className="truncate text-foreground">{summary}</span>
          <span className="truncate text-muted-foreground">{summaryDetail}</span>
        </span>
      )}
      <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-end gap-3 sm:col-start-3">
        {/* The status word's hand is the row's, not each caller's: a
            `sentence` StatusDot has no size of its own and would inherit the
            page's 16px here, next to a 14px name. */}
        {status === undefined ? null : (
          <span className="text-xs text-muted-foreground">{status}</span>
        )}
        {/* The menu before the verb: hidden, it still takes its width, and
            the verb keeps the content edge every other verb on the page ends on. */}
        {menu === undefined || menu === null ? null : (
          <span className="flex opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            {menu}
          </span>
        )}
        {action}
      </span>
      {expansion === undefined ? null : (
        <div className="col-span-full min-w-0 pb-2">{expansion}</div>
      )}
    </li>
  );
}
