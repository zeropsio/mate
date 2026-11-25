import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * What a thing is, on a tile of its own before its name: a product's logo (an agent, a tool it
 * signs in to, a design app), an organization's letter, a tool's letters, the icon of a kind of
 * thing that has no face. One tile for every such mark, so a list of them reads alike. A person
 * is their `PersonAvatar` and a Mate its `MateFace`, never a tile.
 *
 * Sizes follow the row they lead (`Row`): `md` (32 px) an `md` row's or a card's start, `lg`
 * (36 px) an `lg` row's or a picker's start, both raised on a hairline; `sm` (22 px) a compact
 * line, flat. The mark inside takes the size its tile gives it: an icon or a logo 16, 18 or 14 px,
 * letters in the tile's own type. `ground="menu"` is the tile on the menu's ground: flat, in the
 * menu's tint and its muted ink. Decorative: the name beside it says what it is.
 */
const logoTileVariants = cva(
  "flex shrink-0 items-center justify-center rounded-control leading-none font-semibold [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "md", ground: "card" },
    variants: {
      size: {
        sm: "size-5.5 text-3xs [&_svg:not([class*='size-'])]:size-3.5",
        md: "size-8 text-body [&_svg:not([class*='size-'])]:size-4",
        lg: "size-9 text-body [&_svg:not([class*='size-'])]:size-4.5",
      },
      ground: {
        card: "bg-accent text-foreground",
        menu: "bg-sidebar-foreground/6 text-sidebar-muted-foreground",
      },
    },
    compoundVariants: [
      { size: ["md", "lg"], ground: "card", className: "border border-border/60 shadow-xs" },
    ],
  },
);

function LogoTile({
  className,
  size,
  ground,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof logoTileVariants>) {
  return (
    <span
      aria-hidden="true"
      className={cn(logoTileVariants({ size, ground }), className)}
      data-slot="logo-tile"
      {...props}
    />
  );
}

export { LogoTile };
