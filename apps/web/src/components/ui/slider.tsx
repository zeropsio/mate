"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "~/lib/utils";

/**
 * One number picked along a range, where the person judges the effect by eye (contrast, opacity)
 * rather than types it: a 6 px track filled in the primary colour up to a round thumb that sits
 * inside the track's ends. `aria-label` names the thumb's own input, the one a screen reader and the
 * keyboard reach. Read the value from `onValueChange`; show it beside the slider when the number
 * matters.
 */
function Slider({
  className,
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      className={cn("group/slider data-disabled:opacity-64", className)}
      data-slot="slider"
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control
        className="flex h-6 w-full cursor-pointer touch-none items-center select-none group-data-disabled/slider:cursor-not-allowed"
        data-slot="slider-control"
      >
        <SliderPrimitive.Track
          className="relative h-1.5 w-full rounded-full bg-muted-foreground/22 inset-ring inset-ring-border/55"
          data-slot="slider-track"
        >
          <SliderPrimitive.Indicator
            className="rounded-full bg-primary inset-ring inset-ring-border/55"
            data-slot="slider-indicator"
          />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            className="size-4 rounded-full border-2 border-primary bg-background shadow-edge outline-none transition-transform duration-150 ease-out-strong group-hover/slider:scale-108 group-active/slider:scale-94 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-1 has-focus-visible:ring-offset-background group-data-disabled/slider:scale-100"
            data-slot="slider-thumb"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
