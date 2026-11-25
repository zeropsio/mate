import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A key or a chord's key. `muted` stands on the page, a menu or a sentence; `ink` sits inside a
 * press, a chip in the press's own ink (a primary's ⌘↵), so it reads on any of its grounds.
 */
function Kbd({
  className,
  tone = "muted",
  ...props
}: React.ComponentProps<"kbd"> & { readonly tone?: "muted" | "ink" }) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded-mark px-1 font-medium font-sans text-caption [&_svg:not([class*='size-'])]:size-3",
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
