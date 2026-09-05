/**
 * One environment on the projects screen, as a row of a table every project
 * shares: who lives in it, its tag, its name, where it is reachable, what its
 * Mate is doing.
 *
 * The seat leads. An environment with a Mate is led by the Mate — its face in
 * its colour and its name — because that is who a person is here to talk to;
 * an environment without one shows the empty seat: the one verb that fills
 * it on a dev environment, a quiet dash where a Mate is not for. Every other
 * column is the environment's. The columns are fixed page-wide
 * (`ZEROPS_ENVIRONMENT_GRID`), so a row in one project lines up with a row in
 * the next, and a table's header names the columns once.
 *
 * A connected Mate's row is the way into its conversation: the name is the
 * button and stretches over the row; the chips, the verb and the menu sit
 * above it. Structural: every word about state and every verb is the
 * caller's (R5).
 */
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { MateMarkState, MateTintId, ServiceStatusToneId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { MateFace, MicroLabel } from "./primitives";
import { ZeropsRouteChips } from "./ZeropsPublicRoutes";

/**
 * The one column template. Seat, tag, environment, public access, activity,
 * menu — fixed where a word lives, flexible where a name or a list does, so
 * every table on the page draws the same columns.
 */
export const ZEROPS_ENVIRONMENT_GRID =
  "md:grid-cols-[minmax(9rem,12rem)_5.5rem_minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(9rem,14rem)_2rem]";

const ROW_AREAS =
  "[grid-template-areas:'seat_tag_menu'_'env_env_env'_'routes_routes_routes'_'activity_activity_activity'] md:[grid-template-areas:'seat_tag_env_routes_activity_menu']";

const TONE_TEXT_CLASS: Record<ServiceStatusToneId, string> = {
  ok: "text-[var(--zerops-status-ok-text,var(--foreground))]",
  busy: "text-[var(--zerops-status-busy-text,var(--foreground))]",
  attention: "text-[var(--zerops-status-attention-text,var(--foreground))]",
  failed: "text-[var(--zerops-status-failed-text,var(--foreground))]",
  off: "text-muted-foreground",
};

/** The table's header: the column names, once, as labels. */
export function ZeropsEnvironmentTableHeader({
  lead = "Mate",
}: {
  /** What the first column holds — a Mate in a project's table, a tool in the tools'. */
  readonly lead?: string;
}) {
  return (
    <div
      className={cn("hidden h-8 items-center gap-x-4 px-3 md:grid", ZEROPS_ENVIRONMENT_GRID)}
      data-zerops-surface="environment-table-header"
      role="row"
    >
      {[lead, "Tag", "Environment", "Public access", "Activity"].map((column) => (
        <MicroLabel key={column} role="columnheader">
          {column}
        </MicroLabel>
      ))}
      <span aria-hidden="true" />
    </div>
  );
}

/**
 * The status word beside a face — the design system's dot-and-word rule with
 * the face as the dot. Sentence case at text size, not a label: it is read,
 * not scanned, and six of them in a column must not shout.
 */
export function ZeropsMateWord({
  label,
  tone,
  className,
  pulse = false,
}: {
  readonly label: string;
  /** A platform tone, for a Mate whose socket is not up. */
  readonly tone?: ServiceStatusToneId;
  /** The thread status pill's own colour class, for a connected Mate. */
  readonly className?: string;
  readonly pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium",
        tone === undefined ? className : TONE_TEXT_CLASS[tone],
        pulse && "animate-status-pulse motion-reduce:animate-none",
      )}
      data-zerops-surface="mate-word"
    >
      {label}
    </span>
  );
}

/** A verb at the end of a status phrase — "Ready · Connect". Blue acts. */
export function ZeropsMateVerb({
  label,
  onClick,
  disabled = false,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      className="relative z-[1] shrink-0 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
      data-zerops-primary-action={label}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

/** The seat, taken: a Mate's face and name. */
export function ZeropsMateSeat({
  name,
  tint,
  face,
  onOpen,
}: {
  readonly name: string;
  readonly tint: MateTintId;
  readonly face: MateMarkState;
  /** Opens the conversation; the name then stretches over the whole row. */
  readonly onOpen?: (() => void) | undefined;
}) {
  return (
    <>
      <MateFace size="sm" state={face} tint={tint} />
      {onOpen ? (
        <button
          className="min-w-0 truncate rounded-sm text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
          data-zerops-surface="mate-open"
          onClick={onOpen}
          type="button"
        >
          {name}
        </button>
      ) : (
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{name}</span>
      )}
    </>
  );
}

/** The seat, empty: the verb that fills it, or a dash where a Mate is not for. */
export function ZeropsEmptySeat({
  label,
  onClick,
  disabled = false,
}: {
  /** Absent draws the dash. */
  readonly label?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
}) {
  if (label === undefined || onClick === undefined) {
    return (
      <span
        aria-label="No Mate"
        className="hidden text-sm text-muted-foreground/50 md:inline"
        data-zerops-surface="empty-seat"
      >
        —
      </span>
    );
  }
  return (
    <button
      className="relative z-[1] -ms-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
      data-zerops-primary-action={label}
      data-zerops-surface="empty-seat"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">+</span>
      <span>{label}</span>
    </button>
  );
}

export interface ZeropsEnvironmentRowProps {
  /** Who lives here: a `ZeropsMateSeat`, or a `ZeropsEmptySeat`. */
  readonly seat: ReactNode;
  /** Dev, Stage, Production — or nothing for an environment with no role. */
  readonly roleLabel: string | null;
  /** The Zerops project — what the Zerops GUI calls it. */
  readonly environmentName: string;
  /** A word about the project when it is not simply there: creating, stopped. */
  readonly status?: ReactNode;
  /** Absent means unknown; the cell then says nothing rather than "none". */
  readonly routes?: ReadonlyArray<ZeropsPublicRoute> | undefined;
  /** The Mate's state, in words: `ZeropsMateWord`, a subject, a `ZeropsMateVerb`, or a skeleton. */
  readonly activity?: ReactNode;
  readonly menu?: ReactNode;
  readonly busy?: boolean;
  /** True when the seat stretches over the row: the row then reads as a way in. */
  readonly opens?: boolean;
  readonly className?: string;
}

export function ZeropsEnvironmentRow({
  seat,
  roleLabel,
  environmentName,
  status,
  routes,
  activity,
  menu,
  busy = false,
  opens = false,
  className,
}: ZeropsEnvironmentRowProps) {
  return (
    <div
      aria-busy={busy || undefined}
      className={cn(
        "group/row relative grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors md:gap-x-4 md:py-0",
        ZEROPS_ENVIRONMENT_GRID,
        ROW_AREAS,
        opens && "hover:bg-accent/50",
        className,
      )}
      data-zerops-environment-row="true"
      role="row"
    >
      <div
        className="flex min-w-0 items-center gap-2 [grid-area:seat]"
        data-zerops-row-cell="seat"
        role="cell"
      >
        {seat}
      </div>
      <div className="flex items-center [grid-area:tag]" data-zerops-row-cell="tag" role="cell">
        <MicroLabel className="truncate">{roleLabel ?? ""}</MicroLabel>
      </div>
      <div
        className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground [grid-area:env]"
        data-zerops-row-cell="environment"
        role="cell"
      >
        <span className="min-w-0 truncate">{environmentName}</span>
        {status === undefined || status === null ? null : (
          <span className="flex shrink-0 items-center" data-zerops-row-cell="status">
            {status}
          </span>
        )}
      </div>
      <div
        className="flex min-w-0 items-center py-1 [grid-area:routes]"
        data-zerops-row-cell="routes"
        role="cell"
      >
        {routes === undefined ? null : (
          <ZeropsRouteChips label={`Public access of ${environmentName}`} routes={routes} />
        )}
      </div>
      <div
        className="flex min-w-0 items-center gap-1.5 text-xs [grid-area:activity]"
        data-zerops-row-cell="activity"
        role="cell"
      >
        {activity}
      </div>
      <div className="flex justify-end [grid-area:menu]" data-zerops-row-cell="menu" role="cell">
        {menu === undefined ? null : (
          <span className="relative z-[1] flex opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            {menu}
          </span>
        )}
      </div>
    </div>
  );
}
