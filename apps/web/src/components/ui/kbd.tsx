import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A key or a chord's key. `muted` stands on the page, a menu or a sentence; `ink` sits inside a
 * press or a tooltip, a chip in its own ink (a primary's ⌘↵), so it reads on any of its grounds.
 * `sm` fits a line of caption type, as a tooltip's key does.
 */
function Kbd({
  className,
  tone = "muted",
  size = "default",
  ...props
}: React.ComponentProps<"kbd"> & {
  readonly tone?: "muted" | "ink";
  readonly size?: "default" | "sm";
}) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex select-none items-center justify-center gap-1 rounded-mark font-medium font-sans [&_svg:not([class*='size-'])]:size-3",
        size === "sm"
          ? "h-4 min-w-4 gap-px px-1 text-2xs tabular-nums"
          : "h-5 min-w-5 px-1 text-caption",
        tone === "muted" ? "bg-muted text-muted-foreground" : "bg-current/18",
        className,
      )}
      data-slot="kbd"
      data-tone={tone}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
