"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * A few presses that act on what they stand over, on a ground of their own so whatever runs under
 * them never shows through: a terminal's split, new and close over its output, a table's copy on
 * its corner, a picture's tools under the viewer's stage. Its presses are ghost `Button`s, groups
 * of them parted by a vertical `Separator`; it is a `toolbar` to a reader, named by `aria-label`.
 *
 * - `size`: `sm` sits on the surface it acts on: a control's corner, 2 px around its icon presses,
 *   a hairline and the faintest lift; `md` floats over a stage: the card's corner, 6 px around
 *   presses with their words, on a popup's lift.
 *
 * A row of presses heading a pane is a `PanelBar`; one press floating over scrolling content is a
 * `FloatingAction`; a choice among a few is a `ToggleGroup`.
 */
const toolbarVariants = cva(
  "flex w-fit max-w-full items-center border bg-popover text-popover-foreground",
  {
    defaultVariants: { size: "sm" },
    variants: {
      size: {
        sm: "gap-0.5 rounded-control border-border/80 p-0.5 shadow-xs",
        md: "flex-wrap justify-center gap-1 rounded-card border-border p-1.5 shadow-popup",
      },
    },
  },
);

type ToolbarProps = useRender.ComponentProps<"div"> & VariantProps<typeof toolbarVariants>;

function Toolbar({ className, render, size, ...props }: ToolbarProps) {
  const defaultProps = {
    className: cn(toolbarVariants({ size }), className),
    "data-slot": "toolbar",
    role: "toolbar",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { Toolbar };
