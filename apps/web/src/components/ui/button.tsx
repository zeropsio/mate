"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * The one action. `primary` is the single next step on a surface (blue acts), `secondary` sits
 * beside it, `ghost` is a quiet tool, `destructive` only deletes, stops or acts on Production,
 * `link` reads as a word.
 * Sizes: `md` by default, `sm` in dense rows, `xs` for a row's verb within its line (a change's
 * Review, everywhere it stands), `lg` only for a page's one hero action; `icon-sm` and
 * `icon-md` are the square forms of `sm` and `md`, `icon-xs` a 24 px one in a card's head. A button is a rectangle on the control radius;
 * a label is a Badge pill, so an action never reads as a tag.
 */
const buttonVariants = cva(
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
        xs: "h-fit min-h-6 gap-1 px-[calc(--spacing(2)-1px)] py-0 text-line [&_svg:not([class*='size-'])]:size-3",
        sm: "h-fit min-h-7 gap-1.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] text-body [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-fit min-h-8 gap-1.5 px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1)-1px)] text-body",
        lg: "h-fit min-h-10 gap-2 px-[calc(--spacing(4)-1px)] py-[calc(--spacing(1)-1px)] text-body",
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
        ghost:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground [:hover,[data-pressed]]:bg-accent",
        /** A ghost in the secondary ink, the foreground's on hover: a quiet way back or aside under a primary press. */
        "ghost-muted":
          "[--control-icon-color:currentColor] border-transparent text-muted-foreground [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground",
        destructive:
          "border-destructive bg-destructive text-primary-foreground shadow-xs shadow-destructive/24 not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90",
        link: "border-transparent text-primary underline-offset-4 [:hover,[data-pressed]]:underline",
        /** A quiet press that deletes: the red word alone, beside the quiet presses it ends. */
        "destructive-ghost":
          "[--control-icon-color:currentColor] border-transparent text-destructive-foreground [:hover,[data-pressed]]:bg-destructive/8",
      },
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;
type ButtonShape = NonNullable<VariantProps<typeof buttonVariants>["shape"]>;

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
