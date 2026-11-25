import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

/**
 * What a details block says, read from its start: long words scrolling in their own box. Its
 * content wears it (a log, a refusal), so the disclosure never reaches into what it holds.
 */
export const DETAILS_TEXT_CLASS =
  "max-h-48 overflow-auto text-left whitespace-pre-wrap wrap-anywhere";

/** A stop's one way on, and a stage's press: centred under the sentence. */
export const ARRIVAL_ACTS_CLASS = "flex flex-wrap items-center justify-center gap-2";

/**
 * Diagnostics share the stage's centred disclosure, with readable content inside it; `start`
 * sets the disclosure at the start of its line, where it stands under a form's words.
 */
export function MateStateDetails({
  label = "Details",
  align = "center",
  children,
}: {
  readonly label?: string;
  readonly align?: "center" | "start";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full min-w-0 text-body text-muted-foreground",
        align === "start" ? "text-left" : "text-center",
      )}
    >
      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-body text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          {label}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 group-data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="mt-3 text-left">{children}</div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
