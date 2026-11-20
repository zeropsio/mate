import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

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
      <div
        data-chat-composer-mobile-pending-compact="true"
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg border border-border/55 bg-background/55 p-1.5 pl-3 transition-colors hover:bg-background/80",
          !multiSelect && "p-0",
        )}
      >
        <button
          type="button"
          className={cn(
            "min-w-0 flex-1 truncate bg-transparent py-1.5 text-left text-sm",
            customAnswer ? "text-foreground" : "text-placeholder",
            !multiSelect && "px-3 py-2",
          )}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onExpand}
          aria-label="Write custom answer"
        >
          {customAnswer || "Write custom answer"}
        </button>
        {tasksBadge}
        {stashBadge}
        {multiSelect ? actions : null}
      </div>
    </div>
  );
}
