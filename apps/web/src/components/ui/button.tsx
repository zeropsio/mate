"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * The one action. `primary` is the single next step on a surface (blue acts), `secondary` sits
 * beside it, `ghost` is a quiet tool, `destructive` only deletes or stops, `link` reads as a word.
 * Sizes: `md` by default, `sm` in dense rows, `lg` only for a page's one hero action; `icon-sm` and
 * `icon-md` are the square forms of `sm` and `md`. A button is a rectangle on the control radius;
 * a label is a Badge pill, so an action never reads as a tag.
 */
const buttonVariants = cva(
  "[--control-icon-color:currentColor] relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-control border font-medium outline-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-strong pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "md",
      variant: "primary",
    },
    variants: {
      size: {
        sm: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-caption [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-8 gap-1.5 px-[calc(--spacing(3)-1px)] text-body",
        lg: "h-10 gap-2 px-[calc(--spacing(4)-1px)] text-body",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-md": "size-8",
        // Migrating: deleted once every call site names a size above.
        default: "h-8 gap-1.5 px-[calc(--spacing(3)-1px)] text-body",
        compact: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-caption",
        icon: "size-8",
        "icon-lg": "size-8",
        "icon-micro": "size-6",
        "icon-xl": "size-8",
        "icon-xs": "size-6",
        micro: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-caption",
        "sm-multiline": "h-8 gap-1.5 px-[calc(--spacing(3)-1px)] text-body",
        xl: "h-10 gap-2 px-[calc(--spacing(4)-1px)] text-body",
        xs: "h-6 gap-1 px-[calc(--spacing(2)-1px)] text-caption",
      },
      variant: {
        primary:
          "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/24 not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-primary/90",
        secondary:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-input bg-popover text-foreground shadow-xs/5 [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-accent",
        ghost:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground [:hover,[data-pressed]]:bg-accent",
        destructive:
          "border-destructive bg-destructive text-primary-foreground shadow-xs shadow-destructive/24 not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90",
        link: "border-transparent text-primary underline-offset-4 [:hover,[data-pressed]]:underline",
        // Migrating: deleted once every call site names a variant above.
        default:
          "border-primary bg-primary text-primary-foreground [:hover,[data-pressed]]:bg-primary/90",
        "destructive-outline": "border-destructive bg-destructive text-primary-foreground",
        "ghost-destructive": "border-transparent text-foreground [:hover,[data-pressed]]:bg-accent",
        "ghost-muted": "border-transparent text-foreground [:hover,[data-pressed]]:bg-accent",
        "ghost-primary": "border-transparent text-foreground [:hover,[data-pressed]]:bg-accent",
        glass: "border-transparent text-foreground [:hover,[data-pressed]]:bg-accent",
        outline: "border-input bg-popover text-foreground [:hover,[data-pressed]]:bg-accent/50",
        pill: "border-primary bg-primary text-primary-foreground [:hover,[data-pressed]]:bg-primary/90",
        "warning-outline":
          "border-input bg-popover text-foreground [:hover,[data-pressed]]:bg-accent/50",
      },
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
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
export { Button, buttonVariants, type ButtonSize, type ButtonVariant };

const inlineButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-64",
  {
    defaultVariants: { tone: "default" },
    variants: {
      tone: {
        default: "text-foreground",
        muted: "text-muted-foreground hover:text-foreground",
        destructive: "text-destructive/80 hover:text-destructive",
        /** Opens a menu from inside a sentence; the dotted underline marks it as a choice. */
        picker:
          "gap-1.5 text-foreground underline decoration-foreground/30 decoration-dotted decoration-from-font underline-offset-4 hover:decoration-foreground hover:decoration-solid data-popup-open:decoration-foreground data-popup-open:decoration-solid",
      },
    },
  },
);

/** An inline text action that keeps the size of the surrounding text and underlines on hover. */
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
