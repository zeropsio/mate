import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A product's logo on a tile of its own, before the product's name: an agent (Claude, Codex,
 * OpenCode) or a tool it signs in to. `md` (32 px) and `lg` (36 px) stand at a card's or a
 * picker's start, raised on a hairline; `sm` (22 px) leads a compact line, flat on the accent
 * ground. The logo inside takes the size its tile gives it. Decorative: the name beside it says
 * what it is.
 */
const logoTileVariants = cva(
  "flex shrink-0 items-center justify-center rounded-control bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "md" },
    variants: {
      size: {
        sm: "size-5.5 [&_svg:not([class*='size-'])]:size-3.5",
        md: "size-8 border border-border/60 shadow-xs [&_svg:not([class*='size-'])]:size-4",
        lg: "size-9 border border-border/60 shadow-xs [&_svg:not([class*='size-'])]:size-4.5",
      },
    },
  },
);

function LogoTile({
  className,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof logoTileVariants>) {
  return (
    <span
      aria-hidden="true"
      className={cn(logoTileVariants({ size }), className)}
      data-slot="logo-tile"
      {...props}
    />
  );
}

export { LogoTile };
