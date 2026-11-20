import { use, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { type Failure, Mark } from "./RunMarks";
import { TimelineRowCtx } from "./timelineContext";
import {
  CallGroupContext,
  ChatLineContext,
  ListedContext,
  PlopsContext,
  RidesContext,
} from "./runCardContext";

/**
 * A run of calls, one after another: each a row of the ledger, 16 px apart as
 * every row is, every call's time on the card's one right edge. Each wears
 * its own mark in the Mate's column, beside it. One holder for the run, so a
 * call joining it grows it at its foot and never re-keys a row above.
 */
export function CallGroup({ children }: { readonly children: ReactNode }) {
  const shownRef = useRef(false);
  useEffect(() => {
    shownRef.current = true;
  }, []);
  return (
    <CallGroupContext value={shownRef}>
      <div className="grid w-full min-w-0 gap-4" data-chat-calls>
        {children}
      </div>
    </CallGroupContext>
  );
}

/**
 * One call, as its row of the bubble — a failure by its mark, never a flood —
 * its mark in the Mate's column beside it — out of the bubble, in the column
 * the chat's row keeps for it. A call joining a bubble already there rises in
 * on its own; one that came with its bubble rises in with it.
 */
export function CallRow({
  kind,
  mark,
  failure = null,
  children,
}: {
  /** What the call stands for, for the page's own tests and probes. */
  readonly kind: string;
  /** What kind of call it is, in the Mate's column. */
  readonly mark: ReactNode;
  /** Where it failed: still broken, or undone by a later step. */
  readonly failure?: Failure | null;
  readonly children: ReactNode;
}) {
  const group = use(CallGroupContext);
  // A call a resync brings is simply there.
  const { syncing } = use(TimelineRowCtx);
  // One riding in a card that plops rises in, though its card is new.
  const rides = use(RidesContext);
  const [joined] = useState(() => ((group?.current ?? false) || rides) && !syncing);
  const lineKey = use(ChatLineContext);
  // As it mounted: a call that landed by a plop never rises in later.
  const plopping = use(PlopsContext);
  const [plops] = useState(plopping);
  // In a folded row's list it is a line of that row: the row is what the card's motion reads.
  if (use(ListedContext)) {
    return (
      <div
        className="relative min-w-0"
        data-chat-failed={failure ?? undefined}
        data-chat-kind={kind}
        data-quick-call
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn("relative min-w-0", joined && !plops && "run-rise")}
      data-run-rises={joined && !plops ? "" : undefined}
      data-chat-bubble={failure === null ? "tool" : "failed"}
      data-chat-failed={failure ?? undefined}
      data-chat-kind={kind}
      data-chat-row
      data-run-key={lineKey ?? undefined}
    >
      {/* Its mark stands off the bubble, over the row's empty column. */}
      <span className="absolute end-full top-0 me-2">
        <Mark line="call">{mark}</Mark>
      </span>
      {children}
    </div>
  );
}
