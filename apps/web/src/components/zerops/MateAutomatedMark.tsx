/**
 * The small mark after an automated Mate's name, in the menu and on its card: it looks like any
 * Mate otherwise, and the mark's words stand in its tooltip, as the Chief's sign's do.
 */
import { WorkflowIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const MATE_AUTOMATED_WORDS = "Automated: takes tasks from GitHub issues";

export function MateAutomatedMark() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={MATE_AUTOMATED_WORDS}
            className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70"
            data-zerops-surface="mate-automated-mark"
            role="img"
          />
        }
      >
        <WorkflowIcon aria-hidden="true" className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">{MATE_AUTOMATED_WORDS}</TooltipPopup>
    </Tooltip>
  );
}
