import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { Skeleton } from "../../ui/skeleton";
import { StatusDot } from "./StatusDot";

/**
 * A panel's edge, in the colour of the answer inside it.
 *
 * Exported because a panel whose body is a *list* of answers — the worst of
 * them decides the edge — cannot use the component below and must still take
 * its border from the one table. Two tables is how a release came to wear the
 * same amber as a rebase (2026-09-19).
 */
const VERDICT_BORDER_CLASS: Record<ServiceStatusToneId, string> = {
  ok: "border-[var(--zerops-status-ok)]/40",
  busy: "border-[var(--zerops-status-busy)]/40",
  attention: "border-[var(--zerops-status-attention)]/40",
  failed: "border-[var(--zerops-status-failed)]/40",
  off: "border-border",
};

/**
 * The panel's own box, shared with the placeholder below so the two cannot
 * drift: a skeleton eight pixels taller than the answer it stands in for is
 * the layout shift it was put there to prevent.
 */
const VERDICT_PANEL_CLASS =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5";

type VerdictPanelProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** The answer, in one sentence a person could read aloud. */
  readonly text: string;
  readonly tone: ServiceStatusToneId;
  /** The verb — or verbs — that act on that sentence. */
  readonly children?: React.ReactNode;
};

/**
 * What a surface opens with: the answer, and the verb that acts on it.
 *
 * One object because it is one idea. A panel that states a fact and a button
 * that changes it were two elements on the projects screen until the owner
 * asked why (2026-09-18: "why are '1 waiting' and 'Release' two different
 * elements?"), and every surface since — a project's page, an environment's,
 * a change's, a repository's — opens with this instead of with sections of
 * equal weight.
 *
 * The sentence is never written here (R5): it comes from `client-runtime`,
 * where a test and a harness can read every state of it without a forge or a
 * container behind them.
 */
function VerdictPanel({ children, className, text, tone, ...props }: VerdictPanelProps) {
  return (
    <div
      {...props}
      className={cn(VERDICT_PANEL_CLASS, VERDICT_BORDER_CLASS[tone], className)}
      data-zerops-primitive="verdict-panel"
    >
      <StatusDot className="min-w-0 text-sm text-foreground" label={text} sentence tone={tone} />
      {children === undefined ? null : (
        <span className="flex shrink-0 items-center gap-2">{children}</span>
      )}
    </div>
  );
}

/**
 * The place an answer will take, held open while it is still being read.
 *
 * A surface that opens with a verdict cannot open with a *guess* at one: the
 * Git tab used to say "No code here yet." before its forge had answered, list
 * the Mate's commits under that sentence, and then replace the whole panel
 * (measured on the live account, 2026-09-19). Saying nothing is right; saying
 * nothing in a box of a different height only moves the jump, so the shape is
 * the panel's own and the line inside it is the `StatusDot`'s 20 px.
 */
function VerdictPanelWaiting({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn(VERDICT_PANEL_CLASS, "border-border", className)}
      data-zerops-primitive="verdict-panel-waiting"
    >
      <span className="flex h-5 min-w-0 items-center gap-1.5">
        <Skeleton className="size-2 shrink-0 rounded-full" />
        <Skeleton className="h-3 w-44 max-w-full" />
      </span>
    </div>
  );
}

export { VerdictPanel, VerdictPanelWaiting, VERDICT_BORDER_CLASS };
export type { VerdictPanelProps };
