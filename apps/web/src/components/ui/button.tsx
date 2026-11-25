"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * The one action. `primary` is the single next step on a surface (blue acts), `secondary` sits
 * beside it, `ghost` is a quiet tool, `destructive` only deletes, stops or acts on Production,
 * `link` reads as a word, `sidebar` is a ghost on the menu's own ground, `send` the composer's
 * message-action ink, `scrim` a ghost on a picture's dark stage, `warning` a count that opens what
 * waits, `bare` a press whose content is its look.
 * Sizes: `md` by default, `sm` in dense rows, `xs` for a row's verb within its line (a change's
 * Review, everywhere it stands; 24 px, a step taller on a phone like the kit's xs Select), `2xs` a count on a tile's corner, `lg` only for a page's one hero
 * action; `icon-sm` and `icon-md` are the square forms of `sm` and `md`, `icon-xs` a 24 px one in
 * a card's head. A button is a rectangle on the control radius;
 * a label is a Badge pill, so an action never reads as a tag.
 */
const controlVariants = cva(
  "[--control-icon-color:currentColor] relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-control border font-medium outline-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-strong pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      shape: "rectangle",
      size: "md",
      variant: "primary",
    },
    variants: {
      /**
       * Presses are rectangles. `round` is for the two presses drawn round: a round icon press
       * (the composer's send and stop) and a pill press (a quiet choice under a name, like Shuffle).
       */
      shape: {
        rectangle: "",
        round: "rounded-full",
      },
      size: {
        /** A count on a tile's corner (the rail's Waiting count): 20 px, the Badge pill's height. */
        "2xs":
          "h-5 min-w-5 gap-1 px-[calc(--spacing(1.5)-1px)] py-0 text-2xs [&_svg:not([class*='size-'])]:size-3",
        xs: "h-fit min-h-7 gap-1 px-[calc(--spacing(2)-1px)] py-0 text-line sm:min-h-6 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-fit min-h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] text-body [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-fit min-h-8 gap-1.5 px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1)-1px)] text-body",
        lg: "h-fit min-h-10 gap-2 px-[calc(--spacing(4)-1px)] py-[calc(--spacing(1)-1px)] text-body",
        /** A glyph press in dense chrome (a tab's close, a table's toggle); a coarse pointer still gets 44 px. */
        "icon-2xs": "size-5 [&_svg:not([class*='size-'])]:size-3",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-md": "size-8",
      },
      variant: {
        /** Black on a light page, white on a dark one: the page's own ink. */
        primary:
          "border-foreground bg-foreground text-background shadow-xs/24 not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-foreground/85",
        secondary:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-input bg-popover text-foreground shadow-xs/5 [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-accent",
        /** A quiet tool; as a menu's trigger it keeps its hover ground while its popup is open. */
        ghost:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground [:hover,[data-pressed],[data-popup-open]]:bg-accent",
        /** A ghost in the secondary ink, the foreground's on hover: a quiet way back or aside under a primary press. */
        "ghost-muted":
          "[--control-icon-color:currentColor] border-transparent text-muted-foreground [:hover,[data-pressed],[data-popup-open]]:bg-accent [:hover,[data-pressed],[data-popup-open]]:text-foreground",
        destructive:
          "border-destructive bg-destructive text-primary-foreground shadow-xs shadow-destructive/24 not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90",
        link: "border-transparent text-primary underline-offset-4 [:hover,[data-pressed]]:underline",
        /**
         * A ghost on the menu: under the pointer or while its popup is open, a step of the menu's ink
         * over whatever it stands on, so a row's verb still shows on the row's own hover ground.
         * A press for the page on view (`aria-current="page"`) stands on the menu's selected ground.
         */
        sidebar:
          "[--control-icon-color:currentColor] border-transparent text-muted-foreground aria-[current=page]:bg-sidebar-row-selected aria-[current=page]:text-sidebar-foreground [:hover,[data-pressed],[data-popup-open]]:bg-sidebar-foreground/12 [:hover,[data-pressed],[data-popup-open]]:text-sidebar-foreground",
        /** A quiet press that deletes: the red word alone, beside the quiet presses it ends. */
        "destructive-ghost":
          "[--control-icon-color:currentColor] border-transparent text-destructive-foreground [:hover,[data-pressed]]:bg-destructive/8",
        /**
         * The composer's message-action ink: its send (`shape="round"`) and its Answer, Refine and
         * Implement pills. Blue only while it can be pressed: held, it is the toolbar's grey.
         */
        send: "border-message-action bg-message-action text-message-action-foreground shadow-xs shadow-message-action/24 transition-[scale,background-color,border-color,color,box-shadow] not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed],[data-popup-open]]:bg-message-action-hover [:hover,[data-pressed],[data-popup-open]]:border-message-action-hover disabled:border-transparent disabled:bg-foreground/9 disabled:text-muted-foreground disabled:opacity-100",
        /** A ghost in light ink on a picture's always-dark stage (a viewer's Close and arrows). */
        scrim:
          "[--control-icon-color:currentColor] border-transparent text-stage-foreground [:hover,[data-pressed]]:bg-stage-foreground/10",
        /**
         * A count that opens what it counts, in the warning tone (what waits on the person): the
         * Badge's warning pill as a press, its figures tabular. With `shape="round"`.
         */
        warning:
          "border-transparent bg-status-attention-surface font-semibold text-status-attention-text tabular-nums [:hover,[data-pressed],[data-popup-open]]:bg-[color-mix(in_oklab,var(--color-status-attention)_22%,var(--color-status-attention-surface))]",
        /** Drawn by `bareButtonClassName` instead: none of the control's look applies. */
        bare: "",
      },
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof controlVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof controlVariants>["size"]>;
type ButtonShape = NonNullable<VariantProps<typeof controlVariants>["shape"]>;

/**
 * `bare`: a press around a picture, a tile or a card body that draws its own look — no ground,
 * border, padding or type of its own, nor any size; the picture's corner (round with
 * `shape="round"`, for a face) and the focus ring's ink and weight (an outline, so it never covers
 * the picture's own edge). Unpositioned, so a holder's stretched press (a face card's body) still
 * reaches the holder's edge. Its content draws its disabled look.
 */
const bareButtonClassName =
  "cursor-pointer rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default";

function buttonVariants({
  variant,
  className,
  ...props
}: VariantProps<typeof controlVariants> & { readonly className?: string | undefined }): string {
  return variant === "bare"
    ? cn(bareButtonClassName, props.shape === "round" && "rounded-full", className)
    : controlVariants({ className, variant, ...props });
}

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
}

function Button({ className, variant, size, shape, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, shape, size, variant })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

// buttonVariants is exported for other components/ui modules only; app code
// renders a Button (with `render` for other elements) instead.
export { Button, buttonVariants, type ButtonShape, type ButtonSize, type ButtonVariant };

const inlineButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-64",
  {
    defaultVariants: { tone: "default" },
    variants: {
      tone: {
        /** An action word in a line of text: blue acts. */
        default: "text-primary",
        muted: "text-muted-foreground hover:text-foreground",
        /** A name that opens what it names (a file, a release, a run): the text's own ink. */
        plain: "text-foreground",
        destructive: "text-destructive/80 hover:text-destructive",
        /** Opens a menu from inside a sentence; the dotted underline marks it as a choice. */
        picker:
          "gap-1.5 text-foreground underline decoration-foreground/30 decoration-dotted decoration-from-font underline-offset-4 hover:decoration-foreground hover:decoration-solid data-popup-open:decoration-foreground data-popup-open:decoration-solid",
      },
    },
  },
);

/**
 * A word that acts inside a sentence: it keeps the size of the text around it, is blue, and
 * underlines on hover. A press that stands on its own is a Button.
 */
export function InlineButton({
  className,
  tone,
  render,
  ...props
}: useRender.ComponentProps<"button"> & VariantProps<typeof inlineButtonVariants>) {
  const defaultProps = {
    className: cn(inlineButtonVariants({ tone }), className),
    "data-slot": "inline-button",
    type: render ? undefined : ("button" as const),
  };
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
