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
  readonly className?: string;
  readonly actionClassName?: string;
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

  // A reserved frame belongs to the composer. Text zoom can enlarge the collapsed
  // frame; explicit expansion scrolls inside the space available above the input.
  return (
    <div
      ref={stackRef}
      className={cn(className, "relative flex min-h-24 flex-col justify-end sm:min-h-20")}
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
            className={
              expanded && hasStack
                ? "relative max-h-40 overflow-y-auto overscroll-contain space-y-2"
                : "relative"
            }
            style={
              expanded && hasStack ? { maxHeight: `min(10rem, ${availableHeight}px)` } : undefined
            }
          >
            <ComposerBannerStackAlert
              item={frontItem}
              attached
              onDismissRequest={() => frontItem.onDismiss?.()}
            />
            {hasStack ? (
              <div
                id={detailsId}
                hidden={!expanded}
                data-composer-banner-stack-expanded-items="true"
                className="space-y-2 pb-4"
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
          {hasStack ? (
            <div className="relative z-10 flex justify-end pb-4">
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? "Collapse notices"
                  : `${items.length - 1} more ${items.length === 2 ? "notice" : "notices"}`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ComposerBannerStackAlert({
  item,
  attached,
  onDismissRequest,
}: {
  readonly item: ComposerBannerStackItem;
  readonly attached: boolean;
  readonly onDismissRequest: () => void;
}) {
  const dismissOnly = item.onDismiss && !item.actions;

  return (
    <Alert
      variant={item.variant}
      layout={item.layout ?? "row"}
      className={cn(
        attached
          ? "chat-composer-drawer-surface chat-composer-drawer-attached px-3 pt-2 pb-[calc(var(--chat-composer-attachment-overlap)_+_0.375rem)] text-xs sm:px-4"
          : "alert-glass rounded-2xl",
        item.className,
      )}
      data-variant={item.variant}
    >
      {item.icon}
      <AlertTitle>{item.title}</AlertTitle>
      {item.description ? <AlertDescription>{item.description}</AlertDescription> : null}
      {item.actions || item.onDismiss ? (
        <AlertAction
          className={cn(
            item.actionClassName,
            dismissOnly
              ? "max-sm:col-start-3 max-sm:row-start-1 max-sm:mt-0 max-sm:self-start"
              : undefined,
          )}
        >
          {item.actions}
          {item.onDismiss ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={item.dismissLabel ?? "Dismiss notice"}
              onClick={onDismissRequest}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
