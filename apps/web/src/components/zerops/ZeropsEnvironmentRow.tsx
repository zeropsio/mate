/**
 * One environment on the projects screen — a Zerops project that is not a
 * Mate's: stage, production, a dev box nobody has set a Mate up in.
 *
 * A row of a list, not of a table. The name and, trailing it, the role as a
 * pill; then, at the far end, only what is worth saying when there is
 * something: a word about the project when it is not simply there (creating,
 * stopped), the one verb ("Set up Mate", on a dev environment), and the menu
 * — which is where the environment's public access and its quieter actions
 * live. A row with nothing to say says nothing: no empty columns, no dashes.
 *
 * Structural: every word about state and every verb is the caller's (R5).
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
  status,
  action,
  menu,
  busy = false,
  className,
}: ZeropsEnvironmentRowProps) {
  return (
    <li
      aria-busy={busy || undefined}
      className={cn("group/row flex min-h-9 items-center gap-2.5", className)}
      data-zerops-environment-row="true"
    >
      <span
        className="min-w-0 truncate text-[13px] text-foreground"
        data-zerops-surface="environment-name"
      >
        {name}
      </span>
      {tag === null ? null : <ZeropsRoleTag label={tag} />}
      <span className="ms-auto flex shrink-0 items-center gap-3">
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
