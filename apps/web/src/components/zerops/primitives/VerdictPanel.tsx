import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type * as React from "react";

import { Skeleton } from "../../ui/skeleton";
import { STATUS_BADGE_TONE } from "./statusBadgeTone";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";

/** The card's tone, the answer's: a service resting off wears the plain hairline. */
const VERDICT_TONE = {
  ok: "ok",
  busy: "busy",
  attention: "attention",
  failed: "failed",
  off: "default",
} as const satisfies Record<ServiceStatusToneId, string>;

/**
 * The panel's own box inside its card, shared with the placeholder below so the two cannot
 * drift: a skeleton eight pixels taller than the answer it stands in for is the layout shift it
 * was put there to prevent.
 */
const VERDICT_PANEL_CLASS = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3";

type VerdictPanelProps = Omit<React.ComponentProps<"div">, "children" | "className"> & {
  /** The answer, in one sentence a person could read aloud. */
  readonly text: string;
  readonly tone: ServiceStatusToneId;
  /**
   * What stands behind the answer — the version, how long ago — said muted after the sentence on
   * its line; on a phone on its own line under it, set in by the dot so it starts under the text.
   */
  readonly detail?: string | undefined;
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
function VerdictPanel({ children, detail, text, tone, ...props }: VerdictPanelProps) {
  return (
    <Card {...props} data-zerops-primitive="verdict-panel" tone={VERDICT_TONE[tone]} variant="flat">
      <div className={VERDICT_PANEL_CLASS}>
        <span className="flex min-w-0 flex-col gap-y-0.5 text-body sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
          <span className="min-w-0 text-foreground">
            <Badge dot tone={STATUS_BADGE_TONE[tone]}>
              {text}
            </Badge>
          </span>
          {detail === undefined ? null : (
            // The dot (8px) and its gap (6px) set the sentence's text 14px in.
            <span className="min-w-0 ps-3.5 text-muted-foreground tabular-nums sm:ps-0">
              {detail}
            </span>
          )}
        </span>
        {children === undefined ? null : (
          <span className="flex shrink-0 items-center gap-2">{children}</span>
        )}
      </div>
    </Card>
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
function VerdictPanelWaiting(props: Omit<React.ComponentProps<"div">, "className">) {
  return (
    <Card
      {...props}
      aria-hidden="true"
      data-zerops-primitive="verdict-panel-waiting"
      variant="flat"
    >
      <div className={VERDICT_PANEL_CLASS}>
        <span className="flex h-5 min-w-0 items-center gap-1.5">
          <Skeleton shape="pill" className="size-2 shrink-0" />
          <Skeleton className="h-3 w-44 max-w-full" />
        </span>
      </div>
    </Card>
  );
}

export { VerdictPanel, VerdictPanelWaiting };
