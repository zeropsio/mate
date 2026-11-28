import type { ReactNode } from "react";

import { Kbd } from "../ui/kbd";

/**
 * A tooltip beside the closed menu's rail, and the menu's other bare counts: what the control is,
 * its key, and its line.
 */
export function RailTip({
  name,
  shortcut,
  line,
}: {
  readonly name: ReactNode;
  readonly shortcut?: string | undefined;
  readonly line?: ReactNode;
}) {
  return (
    <span className="grid max-w-75 gap-px">
      <span className="flex items-center gap-1.5 font-medium">
        {name}
        {shortcut === undefined ? null : (
          <Kbd size="sm" tone="ink">
            {shortcut}
          </Kbd>
        )}
      </span>
      {line === undefined || line === null || line === "" ? null : (
        <span className="truncate text-muted-foreground">{line}</span>
      )}
    </span>
  );
}
