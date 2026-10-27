import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

/** Diagnostics share the stage's centred disclosure, with readable content inside it. */
export function MateStateDetails({
  label = "Details",
  children,
}: {
  readonly label?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="arrival-failure-details w-full">
      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
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
