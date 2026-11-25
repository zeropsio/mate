import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Card } from "../ui/card";

export function ComposerFoldedAnswerRow({
  customAnswer,
  multiSelect,
  onExpand,
  tasksBadge,
  stashBadge,
  actions,
}: {
  readonly customAnswer: string | undefined;
  readonly multiSelect: boolean | undefined;
  readonly onExpand: () => void;
  readonly tasksBadge: ReactNode;
  readonly stashBadge: ReactNode;
  readonly actions: ReactNode;
}) {
  return (
    <div className="px-3 pb-3 sm:px-4">
      <Card data-chat-composer-mobile-pending-compact="true" variant="inset">
        <div className={cn("flex min-w-0 items-center gap-2", multiSelect && "p-1.5 pl-3")}>
          <Button
            variant="bare"
            className="min-w-0 flex-1"
            onPointerDown={(event) => event.preventDefault()}
            onClick={onExpand}
            aria-label="Write custom answer"
          >
            <span
              className={cn(
                "block truncate py-1.5 text-left text-body",
                customAnswer ? "text-foreground" : "text-placeholder",
                !multiSelect && "px-3 py-2",
              )}
            >
              {customAnswer || "Write custom answer"}
            </span>
          </Button>
          {tasksBadge}
          {stashBadge}
          {multiSelect ? actions : null}
        </div>
      </Card>
    </div>
  );
}
