"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * The box a message is written in: the crew's tell, a comment on a change, a preview of what the
 * composer types in. It is the one white surface where the person acts: the card's ground and an
 * edge of ink, which firms while the caret is inside. Its words are a `Textarea size="line"` (or
 * the composer's editor), its presses sit at its end.
 *
 * - `size`: `sheet` stands at the foot of a conversation or a tab as its own surface: the sheet's
 *   corner, 48 px tall at least, on the composer's soft lift, 18 px before its words; `card` is set
 *   inside a panel, a sheet or a setting (a change's comment, a type preview): the card's corner,
 *   no lift, its presses 5 px from its edge so their corners run parallel to its own.
 * - `locked`: nothing can be written here now, and the frame says why in its own room: no white
 *   and a quieter edge, a step of ink for its ground, so nothing under it moves when it opens.
 *
 * The conversation's own composer is drawn in the same ground, edge, lift and corner by its shell
 * (`base.css`), which joins it to the drawers over it and the strip under it.
 */
const composerFrameVariants = cva(
  "relative flex min-w-0 text-foreground inset-ring transition-[background-color,box-shadow] duration-150 ease-out-strong motion-reduce:transition-none",
  {
    defaultVariants: { size: "sheet", locked: false },
    variants: {
      size: {
        sheet: "min-h-12 rounded-sheet",
        card: "rounded-card",
      },
      locked: {
        false: "bg-card inset-ring-foreground/12 focus-within:inset-ring-foreground/22",
        true: "bg-foreground/4 inset-ring-foreground/7",
      },
    },
    compoundVariants: [
      {
        size: "sheet",
        locked: false,
        className: "items-end gap-2 py-2 ps-4.5 pe-2 shadow-(--chat-composer-shadow)",
      },
      { size: "sheet", locked: true, className: "items-center gap-2.5 py-1.5 ps-4 pe-2" },
      { size: "card", className: "items-end gap-1.5 py-1.25 ps-3 pe-1.25" },
    ],
  },
);

type ComposerFrameProps = useRender.ComponentProps<"div"> &
  VariantProps<typeof composerFrameVariants>;

function ComposerFrame({ className, render, size, locked, ...props }: ComposerFrameProps) {
  const defaultProps = {
    className: cn(composerFrameVariants({ size, locked }), className),
    "data-slot": "composer-frame",
    "data-locked": locked ? "" : undefined,
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { ComposerFrame };
