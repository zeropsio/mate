"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "~/lib/utils";
import { gatedPortal } from "~/components/ui/portal-gate";

const PopoverPortal = gatedPortal(PopoverPrimitive.Portal);

const PopoverCreateHandle = PopoverPrimitive.createHandle;

const Popover = PopoverPrimitive.Root;

function PopoverTrigger({ className, children, ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger className={className} data-slot="popover-trigger" {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

// Popovers hold prose and forms, so a width is fixed rather than a minimum,
// and every width is capped to the viewport.
const popoverPopupWidthClassName = {
  auto: "",
  sm: "w-64",
  md: "w-80",
  lg: "w-96",
} as const;

// The inset around the content. "compact" suits dense content (a list, a code excerpt, a
// row of reactions); "none" is for content that draws its own frame edge to edge.
const popoverViewportPaddingClassName = {
  default: "py-4 [--viewport-inline-padding:--spacing(4)]",
  compact: "py-2 [--viewport-inline-padding:--spacing(3)]",
  // Rounded to the popup so edge-to-edge content clips to its corners.
  none: "rounded-[calc(var(--radius-lg)-1px)] py-0 [--viewport-inline-padding:0px]",
} as const;

function PopoverPopup({
  children,
  className,
  padding = "default",
  width = "auto",
  side = "bottom",
  align = "center",
  sideOffset = 4,
  alignOffset = 0,
  tooltipStyle = false,
  keepMounted = false,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props & {
  padding?: keyof typeof popoverViewportPaddingClassName;
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
  tooltipStyle?: boolean;
  keepMounted?: PopoverPrimitive.Portal.Props["keepMounted"];
  anchor?: PopoverPrimitive.Positioner.Props["anchor"];
  width?: keyof typeof popoverPopupWidthClassName;
}) {
  // The popup sizes itself in CSS, capped by the room Base UI measures
  // (`--available-height`), from its first painted frame. Base UI's Viewport
  // part is not used: it morphs one popup between several triggers' contents,
  // which no popover here has, and its auto-resize measures the popup with
  // that cap lifted, then pins the popup and its positioner to the uncapped
  // size — a menu taller than the room opened at its full height and snapped
  // to its cap once its entrance ended, and was placed by the uncapped size.
  return (
    <PopoverPortal keepMounted={keepMounted}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-[130] max-w-(--available-width)"
        data-slot="popover-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "dropdown-glass relative flex origin-(--transform-origin) rounded-lg text-popover-foreground outline-none transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=calendar]:rounded-xl has-data-[slot=calendar]:before:rounded-[calc(var(--radius-xl)-1px)] data-starting-style:scale-98 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            tooltipStyle &&
              "w-fit text-balance rounded-md text-xs shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]",
            !tooltipStyle &&
              "shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]",
            width !== "auto" && ["max-w-[calc(100vw-2rem)]", popoverPopupWidthClassName[width]],
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          <div
            className={cn(
              "relative size-full max-h-(--available-height) overflow-clip px-(--viewport-inline-padding) has-data-[slot=calendar]:p-2",
              tooltipStyle && padding === "default"
                ? "py-1 [--viewport-inline-padding:--spacing(2)]"
                : popoverViewportPaddingClassName[padding],
              !tooltipStyle && "overflow-y-auto",
            )}
            data-slot="popover-viewport"
          >
            {children}
          </div>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPortal>
  );
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      className={cn("font-semibold text-sm leading-none", className)}
      data-slot="popover-title"
      {...props}
    />
  );
}

export {
  PopoverCreateHandle,
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverPopup as PopoverContent,
  PopoverTitle,
  PopoverClose,
};
