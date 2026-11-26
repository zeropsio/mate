"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * A press that stays on or off. Under the pointer it lights on the item's hover ground
 * (`bg-item-hover`); while on it stands on the picked ground (`bg-item-picked`), a step deeper,
 * the way the one tab open does: a toggle has no mark of its own, so its ground is how it says
 * it is on. `outline` is a field-like press on the field's grounds; `segmented` a choice on a
 * track, the chosen segment raised.
 */
const toggleVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-control border font-medium text-body text-foreground outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-control)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 transition-[background-color,color,box-shadow] duration-150 ease-out-strong hover:bg-item-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:opacity-64 data-pressed:bg-item-picked sm:text-body [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        compact:
          "h-7 min-w-7 rounded-control px-[calc(--spacing(1)-1px)] text-caption [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 min-w-9 px-[calc(--spacing(2)-1px)] sm:h-8 sm:min-w-8",
        lg: "h-10 min-w-10 px-[calc(--spacing(2.5)-1px)] sm:h-9 sm:min-w-9",
        segmented: "h-6 min-w-0 rounded-control px-2.5 text-caption",
        /** A segmented choice inside a dense row. */
        "segmented-sm": "h-5.5 min-w-0 rounded-control px-2.5 text-caption sm:text-caption",
        sm: "h-8 min-w-8 px-[calc(--spacing(1.5)-1px)] sm:h-7 sm:min-w-7",
        xs: "h-7 min-w-7 px-[calc(--spacing(1)-1px)] sm:h-6 sm:min-w-6 rounded-control",
      },
      variant: {
        default: "border-transparent",
        ghost:
          "border-transparent text-foreground shadow-none [:disabled,:active,[data-pressed]]:shadow-none before:shadow-none disabled:opacity-100 disabled:text-muted-foreground disabled:[&_svg]:opacity-100",
        outline:
          "border-input bg-field bg-clip-ground shadow-xs/5 hover:bg-field-hover data-pressed:bg-field-pressed not-disabled:not-active:not-data-pressed:before:shadow-edge [:disabled,:active,[data-pressed]]:shadow-none",
        /**
         * A quiet press on the top bar: the bar's ink, in the header and in the titlebar strip
         * alike, so the panel toggles look the same as the panel opens; hover and on keep the
         * item grounds, and disabled is the ink at 55 %.
         */
        toolbar:
          "border-transparent text-toolbar-foreground shadow-none [:disabled,:active,[data-pressed]]:shadow-none before:shadow-none disabled:opacity-100 disabled:text-toolbar-foreground/55 disabled:[&_svg]:opacity-100",
        segmented:
          "border-transparent text-muted-foreground shadow-none transition-colors before:shadow-none hover:bg-segment-hover hover:text-foreground data-pressed:bg-segment data-pressed:text-foreground data-pressed:shadow-xs/10",
      },
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      className={cn(toggleVariants({ className, size, variant }))}
      data-slot="toggle"
      {...props}
    />
  );
}

// The *Variants function is for components/ui modules only.
export { Toggle, toggleVariants };
