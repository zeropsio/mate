import { COMPOSER_ATTACHED_OUTLINE, COMPOSER_ATTACHED_RAISED } from "./composerAttached";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: "default" | "error" | "info" | "success" | "warning";
  // Ordering hint for stack assemblers: front this banner even though its
  // variant is calm (e.g. live update progress). The stack itself ignores it.
  readonly urgent?: boolean;
  readonly layout?: "row" | "centered";
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackItem>;
  // Optional measurement of the reserved notice frame.
  readonly stackRef?: (element: HTMLDivElement | null) => void;
}

export function ComposerBannerStack({ className, items, stackRef }: ComposerBannerStackProps) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const [availableHeight, setAvailableHeight] = useState(0);
  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    const details = detailsRef.current;
    if (!drawer || !details || items.length < 2 || !expanded) return;
    const measure = () => {
      // Drawer bottom is fixed at the input. Adding back the expanded height
      // measures the space above the collapsed frame without a resize loop.
      const height = Math.max(
        0,
        drawer.getBoundingClientRect().top + details.getBoundingClientRect().height,
      );
      setAvailableHeight((previous) => (previous === height ? previous : height));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(drawer);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items.length, expanded]);
  const frontItem = items[0];
  const hasStack = items.length > 1;
  if (!frontItem) return null;

  // The notices sit on the composer, as tall as they are: no frame is held above them. Explicit
  // expansion scrolls inside the space available above the input.
  return (
    <div
      ref={stackRef}
      className={cn(className, "relative flex flex-col justify-end")}
      data-composer-banner-anchor="true"
    >
      {frontItem ? (
        <div
          ref={drawerRef}
          className="chat-composer-drawer-slot"
          data-composer-banner-drawer="true"
        >
          <div
            ref={detailsRef}
            // The front notice stays attached to the input; expanded notices open above it.
            className={
              expanded && hasStack
                ? "relative flex max-h-40 flex-col-reverse gap-2 overflow-y-auto overscroll-contain"
                : "relative flex flex-col-reverse"
            }
            style={
              expanded && hasStack ? { maxHeight: `min(10rem, ${availableHeight}px)` } : undefined
            }
          >
            <div className="relative">
              {hasStack && !expanded ? (
                // The edge of the next notice peeks above the front one; a click opens the stack.
                <Button
                  className="absolute inset-x-0 -top-3 z-0 h-3 after:absolute after:inset-x-0 after:-top-2 after:h-5"
                  aria-label={`Show ${items.length - 1} more ${items.length === 2 ? "notice" : "notices"}`}
                  aria-expanded={false}
                  aria-controls={detailsId}
                  onClick={() => setExpanded(true)}
                  variant="bare"
                >
                  <span
                    className={cn(
                      "chat-composer-banner-stack-cap mx-auto block h-full rounded-t-card border border-b-0",
                      COMPOSER_ATTACHED_RAISED,
                      COMPOSER_ATTACHED_OUTLINE,
                    )}
                  />
                </Button>
              ) : null}
              <ComposerBannerStackAlert
                item={frontItem}
                attached
                onDismissRequest={() => frontItem.onDismiss?.()}
                stackToggle={
                  hasStack ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      onClick={() => setExpanded((value) => !value)}
                    >
                      {expanded
                        ? "Collapse notices"
                        : `${items.length - 1} more ${items.length === 2 ? "notice" : "notices"}`}
                    </Button>
                  ) : null
                }
              />
            </div>
            {hasStack ? (
              <div
                id={detailsId}
                hidden={!expanded}
                data-composer-banner-stack-expanded-items="true"
                className="space-y-2"
              >
                {items.slice(1).map((item) => (
                  <ComposerBannerStackAlert
                    key={item.id}
                    item={item}
                    attached={false}
                    onDismissRequest={() => item.onDismiss?.()}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ComposerBannerStackAlert({
  item,
  attached,
  onDismissRequest,
  stackToggle,
}: {
  readonly item: ComposerBannerStackItem;
  readonly attached: boolean;
  readonly onDismissRequest: () => void;
  readonly stackToggle?: ReactNode;
}) {
  const dismissOnly = item.onDismiss && !item.actions;
  const dismiss = item.onDismiss ? (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={item.dismissLabel ?? "Dismiss notice"}
      onClick={onDismissRequest}
    >
      <XIcon className="size-3.5" />
    </Button>
  ) : null;

  const alert = (
    <Alert
      variant={item.variant}
      layout={item.layout ?? "row"}
      surface={attached ? "bare" : "glass"}
      icon={item.icon}
      // In the drawer the notice's words end a step above the drawer's open bottom edge.
      className={attached ? "mb-1.5" : undefined}
    >
      <AlertTitle>{item.title}</AlertTitle>
      {item.description ? <AlertDescription>{item.description}</AlertDescription> : null}
      {item.actions || item.onDismiss || stackToggle ? (
        <AlertAction
          className={
            dismissOnly
              ? "max-sm:col-start-3 max-sm:row-start-1 max-sm:mt-0 max-sm:self-start"
              : undefined
          }
        >
          {stackToggle}
          {item.actions}
          {dismiss}
        </AlertAction>
      ) : null}
    </Alert>
  );

  // The front notice is set in the composer's drawer, which draws its surface and tints it from
  // data-variant; the expanded ones float as glass.
  return attached ? (
    <div
      className={cn(
        "chat-composer-drawer-surface chat-composer-drawer-attached px-3 pt-2 text-caption sm:px-4",
        COMPOSER_ATTACHED_RAISED,
        COMPOSER_ATTACHED_OUTLINE,
      )}
      data-variant={item.variant}
    >
      {alert}
    </div>
  ) : (
    alert
  );
}
