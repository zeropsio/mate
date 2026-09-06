/**
 * A conversation catching up with its server: a small spinner in the header's
 * sync slot (`threadSyncSlot.ts`), with the phrase on hover. Upstream stacked
 * this as a drawer above the composer, which moved the composer and the
 * timeline every time the thread's connection blinked; a header slot of fixed
 * size moves nothing.
 */
import { createPortal } from "react-dom";

import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";
import { useThreadSyncSlot } from "./threadSyncSlot";

export function ThreadSyncStatusPill({ phase }: { readonly phase: ThreadSyncPhase }) {
  const slot = useThreadSyncSlot();
  const label = threadSyncLabel(phase);
  if (slot === null) return null;

  return createPortal(
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="flex size-4 items-center justify-center text-muted-foreground"
            data-thread-sync-indicator="true"
          />
        }
      >
        <Spinner aria-label={label} className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>,
    slot,
  );
}
