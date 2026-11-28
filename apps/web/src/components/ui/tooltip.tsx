import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  createContext,
  isValidElement,
  use,
  useEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";

import { isFollowScroll } from "~/lib/followScroll";
import { cn } from "~/lib/utils";
import { Kbd } from "~/components/ui/kbd";
import { gatedPortal } from "~/components/ui/portal-gate";

const TooltipPortal = gatedPortal(TooltipPrimitive.Portal);

/**
 * The app's tooltip timing: a short wait before the first one opens, then the next trigger's opens
 * at once while the pointer moves along a row of them, and none lingers once it leaves.
 */
function TooltipProvider({
  delay = 350,
  closeDelay = 0,
  timeout = 400,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider closeDelay={closeDelay} delay={delay} timeout={timeout} {...props} />
  );
}
/** One tooltip for many triggers (a chart's bars): each trigger names it and passes its payload. */
const TooltipCreateHandle = TooltipPrimitive.createHandle;

type TooltipActionsRef = RefObject<TooltipPrimitive.Root.Actions | null>;
const TooltipHoverContext = createContext<TooltipActionsRef | null>(null);
const TooltipScrollContext = createContext<RefObject<{
  trigger: HTMLElement;
  actionsRef: TooltipActionsRef;
} | null> | null>(null);

/** Dismisses hovered descendants on real scroll events without rerendering the timeline. */
function TooltipScrollDismissArea({ onScrollCapture, ...props }: ComponentProps<"div">) {
  const hovered = useRef<{ trigger: HTMLElement; actionsRef: TooltipActionsRef } | null>(null);
  return (
    <TooltipScrollContext value={hovered}>
      <div
        {...props}
        onScrollCapture={(event) => {
          onScrollCapture?.(event);
          // A box keeping itself at its end while a run streams is not the person scrolling.
          if (isFollowScroll(event.target)) return;
          const tooltip = hovered.current;
          if (!tooltip || tooltip.trigger.contains(tooltip.trigger.ownerDocument.activeElement)) {
            return;
          }
          hovered.current = null;
          // Base UI also cancels delayed hover opens through this action.
          tooltip.actionsRef.current?.close();
        }}
      />
    </TooltipScrollContext>
  );
}

function Tooltip<Payload>(props: TooltipPrimitive.Root.Props<Payload>) {
  const hovered = use(TooltipScrollContext);
  const localActionsRef = useRef<TooltipPrimitive.Root.Actions | null>(null);
  const actionsRef = props.actionsRef ?? localActionsRef;
  useEffect(
    () => () => {
      if (hovered?.current?.actionsRef === actionsRef) hovered.current = null;
    },
    [actionsRef, hovered],
  );

  if (!hovered) return <TooltipPrimitive.Root {...props} />;
  return (
    <TooltipHoverContext value={actionsRef}>
      <TooltipPrimitive.Root
        {...props}
        actionsRef={actionsRef}
        onOpenChange={(open, details) => {
          props.onOpenChange?.(open, details);
          if (!open && !details.isCanceled && hovered.current?.actionsRef === actionsRef) {
            hovered.current = null;
          }
        }}
      />
    </TooltipHoverContext>
  );
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  const hovered = use(TooltipScrollContext);
  const actionsRef = use(TooltipHoverContext);
  // Base UI binds its hover listeners to the first element it renders; a trigger whose element
  // changes kind (a file chip's menu button becoming its link) remounts so hover reaches it.
  const key =
    isValidElement(props.render) && typeof props.render.type === "string"
      ? props.render.type
      : undefined;
  if (!hovered || !actionsRef) {
    return <TooltipPrimitive.Trigger key={key} data-slot="tooltip-trigger" {...props} />;
  }
  return (
    <TooltipPrimitive.Trigger
      key={key}
      data-slot="tooltip-trigger"
      {...props}
      onMouseEnter={(event) => {
        props.onMouseEnter?.(event);
        hovered.current = { trigger: event.currentTarget, actionsRef };
      }}
    />
  );
}

/** How a tooltip draws what it holds: a label, a paragraph or card, a preview, a command. */
type TooltipVariant = "default" | "rich" | "glass" | "code";

const TOOLTIP_LOOK: Record<TooltipVariant, string> = {
  // A label in the page's inverse: no edge, a soft lift, one line until it is long. Words inside
  // that ask for the page's ink or its muted ink get the inverse's, so a second line stays quiet.
  default:
    "max-w-72 bg-tooltip text-pretty font-medium text-tooltip-foreground shadow-tooltip [--color-foreground:var(--color-tooltip-foreground)] [--color-muted-foreground:color-mix(in_oklab,var(--color-tooltip-foreground)_72%,transparent)]",
  // A paragraph or a small card (a description, a preview, a chart's readout) on the popup's ground.
  rich: "max-w-80 text-pretty",
  glass: "dropdown-glass text-popover-foreground shadow-popup",
  // Paths and commands: monospace that breaks anywhere, with room for a long one.
  code: "max-w-120 text-left font-mono text-[11px] leading-relaxed",
};

/** The popup's own card, under `rich` and `code`: its ground, its edge and a small lift. */
const TOOLTIP_CARD =
  "border bg-popover bg-clip-ground text-popover-foreground shadow-md/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-control)-1px)] before:shadow-edge";

function TooltipPopup({
  className,
  align = "center",
  sideOffset = 6,
  side = "top",
  variant = "default",
  shortcut,
  anchor,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & {
  align?: TooltipPrimitive.Positioner.Props["align"];
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  /**
   * `default` is a label: the control's name in a few words. `rich` holds a paragraph or a small
   * card; `code` a path or a command; `glass` a preview over the menu.
   */
  variant?: TooltipVariant;
  /** The key that does the same, as this platform writes it (`⌘K`), after the label. */
  shortcut?: ReactNode;
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <TooltipPortal>
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className="pointer-events-none z-[140] h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) whitespace-normal wrap-anywhere rounded-control text-caption transition-[width,height,opacity] duration-150 ease-out-strong data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0",
            (variant === "rich" || variant === "code") && TOOLTIP_CARD,
            TOOLTIP_LOOK[variant],
            className,
          )}
          data-slot="tooltip-popup"
          data-variant={variant}
          {...props}
        >
          <TooltipPrimitive.Viewport
            className="relative size-full overflow-clip px-(--viewport-inline-padding) py-1 [--viewport-inline-padding:--spacing(2)] data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:truncate **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity"
            data-slot="tooltip-viewport"
          >
            {shortcut === undefined || shortcut === null ? (
              children
            ) : (
              <span className="flex items-start gap-2">
                <span className="min-w-0">{children}</span>
                <Kbd aria-hidden="true" size="sm" tone="ink">
                  {shortcut}
                </Kbd>
              </span>
            )}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPortal>
  );
}

export {
  TooltipProvider,
  TooltipCreateHandle,
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
  TooltipScrollDismissArea,
};
