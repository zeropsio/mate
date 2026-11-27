"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "~/lib/utils";
import { gatedPortal } from "~/components/ui/portal-gate";

const PopoverPortal = gatedPortal(PopoverPrimitive.Portal);

const Popover = PopoverPrimitive.Root;

function PopoverTrigger({ className, children, ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger className={className} data-slot="popover-trigger" {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

// Popovers hold prose and forms, so a width is fixed rather than a minimum,
// and every width is capped to the viewport. `xl` holds a list of rows that each end in an
// action (the menu's Needs you), whose words need the room beside it.
const popoverPopupWidthClassName = {
  auto: "",
  sm: "w-64",
  md: "w-80",
  lg: "w-96",
  xl: "w-112",
} as const;

// The inset around the content. "compact" suits dense content (a list, a code excerpt, a
// row of reactions); "none" is for content that draws its own frame edge to edge.
const popoverViewportPaddingClassName = {
  default: "py-4 [--viewport-inline-padding:--spacing(4)]",
  compact: "py-2 [--viewport-inline-padding:--spacing(3)]",
  // Rounded to the popup so edge-to-edge content clips to its corners.
  none: "rounded-[calc(var(--radius-card)-1px)] py-0 [--viewport-inline-padding:0px]",
} as const;

/**
 * `default` is a panel of prose or a short form, set by `width` and `padding`. `tooltip` is one
 * line that answers a press, in a tooltip's look: it fits its words and pads itself, so it takes
 * neither.
 */
type PopoverPopupVariant =
  | {
      variant?: "default";
      width?: keyof typeof popoverPopupWidthClassName;
      padding?: keyof typeof popoverViewportPaddingClassName;
    }
  | { variant: "tooltip"; width?: never; padding?: never };

function PopoverPopup({
  children,
  className,
  variant = "default",
  padding = "default",
  width = "auto",
  side = "bottom",
  align = "center",
  sideOffset = 4,
  alignOffset = 0,
  keepMounted = false,
  container,
  anchor,
  collisionAvoidance,
  collisionBoundary,
  collisionPadding,
  ...props
}: PopoverPrimitive.Popup.Props &
  PopoverPopupVariant & {
    side?: PopoverPrimitive.Positioner.Props["side"];
    align?: PopoverPrimitive.Positioner.Props["align"];
    sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
    alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
    keepMounted?: PopoverPrimitive.Portal.Props["keepMounted"];
    /**
     * Where it is rendered; the document's end by default. A popover that belongs to a surface
     * keeping its own focus order and its own Escape (the picture's stage) renders inside it.
     */
    container?: PopoverPrimitive.Portal.Props["container"];
    /**
     * What it stands beside when not its trigger: an element, or a point as a virtual element
     * (`{ getBoundingClientRect }`) for a popover that follows a mark or a pointer. It is placed,
     * flipped and kept on screen the same way.
     */
    anchor?: PopoverPrimitive.Positioner.Props["anchor"];
    /**
     * How it keeps to the viewport. A popover that must never cover what sits beside its trigger
     * (the menu's doors, over the conversation) flips above or below and never out to the side.
     */
    collisionAvoidance?: PopoverPrimitive.Positioner.Props["collisionAvoidance"];
    /** The area it keeps inside, by default whatever clips it: a popover on a stage keeps to the stage. */
    collisionBoundary?: PopoverPrimitive.Positioner.Props["collisionBoundary"];
    collisionPadding?: PopoverPrimitive.Positioner.Props["collisionPadding"];
  }) {
  const tooltip = variant === "tooltip";
  // The popup sizes itself in CSS, capped by the room Base UI measures
  // (`--available-height`), from its first painted frame. Base UI's Viewport
  // part is not used: it morphs one popup between several triggers' contents,
  // which no popover here has, and its auto-resize measures the popup with
  // that cap lifted, then pins the popup and its positioner to the uncapped
  // size — a menu taller than the room opened at its full height and snapped
  // to its cap once its entrance ended, and was placed by the uncapped size.
  return (
    <PopoverPortal container={container} keepMounted={keepMounted}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className="z-[130] max-w-(--available-width)"
        data-slot="popover-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "dropdown-glass relative flex origin-(--transform-origin) rounded-card text-popover-foreground outline-none transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-card)-1px)] before:shadow-edge data-starting-style:scale-98 data-starting-style:opacity-0",
            // Leaves as it enters, so a closing popover stops covering the page and taking clicks.
            "data-ending-style:scale-98 data-ending-style:opacity-0",
            tooltip &&
              "w-fit text-balance rounded-control text-caption shadow-md/5 before:rounded-[calc(var(--radius-control)-1px)]",
            !tooltip && "shadow-popup",
            !tooltip &&
              width !== "auto" && ["max-w-[calc(100vw-2rem)]", popoverPopupWidthClassName[width]],
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          <div
            className={cn(
              "relative size-full max-h-(--available-height) overflow-clip px-(--viewport-inline-padding) has-data-[slot=calendar]:p-2",
              tooltip
                ? "py-1 [--viewport-inline-padding:--spacing(2)]"
                : popoverViewportPaddingClassName[padding],
              !tooltip && "overflow-y-auto",
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
      className={cn("font-semibold text-body leading-none", className)}
      data-slot="popover-title"
      {...props}
    />
  );
}

export {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverPopup as PopoverContent,
  PopoverTitle,
  PopoverClose,
};
