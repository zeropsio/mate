"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Button } from "./button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";
import { ScrollArea } from "./scroll-area";
import { hiddenTabsLabel, tabsOutOfView } from "./tabStrip.logic";

/** A tab as the overflow menu lists it once the strip's edges cut it off. */
interface TabStripItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
}

interface TabStripProps {
  /** Every tab, in strip order, as the overflow menu names it. */
  readonly items: ReadonlyArray<TabStripItem>;
  readonly activeId: string | null;
  readonly onSelect: (id: string) => void;
  /** At the strip's end, outside what scrolls: however many tabs are open, it stays in reach. */
  readonly action?: ReactNode;
  /** The tabs themselves (`Tab`), one per item, each carrying its item's `tabId`. */
  readonly children: ReactNode;
  /** The strip doubles as the window's drag region (a desktop title bar). */
  readonly dragRegion?: boolean;
}

/**
 * A row of tabs that scrolls sideways when there are more than its room holds. The tabs its edges
 * cut off are listed in a "N more" menu beside it, and its action (open another, add one) stands
 * after the tabs, outside the scroll, so neither ever scrolls out of reach. The open tab is
 * scrolled into view when it changes.
 */
function TabStrip({ items, activeId, onSelect, action, children, dragRegion }: TabStripProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (activeId === null) return;
    const active = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [],
    ).find((tab) => tab.dataset.tabId === activeId);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  // The tabs the strip's edges cut off, re-read as it scrolls or resizes.
  useEffect(() => {
    const viewport = listRef.current?.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    if (!viewport) return;
    const measure = () => {
      const next = tabsOutOfView(
        viewport.getBoundingClientRect(),
        Array.from(viewport.querySelectorAll<HTMLElement>("[data-tab-id]"), (tab) => {
          const box = tab.getBoundingClientRect();
          return { id: tab.dataset.tabId ?? "", left: box.left, right: box.right };
        }),
      );
      setHiddenIds((current) =>
        current.length === next.length && current.every((id, index) => id === next[index])
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    viewport.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, []);

  const hidden = items.filter((item) => hiddenIds.includes(item.id));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" data-slot="tab-strip">
      <ScrollArea
        className={cn("w-auto min-w-0", dragRegion && "drag-region")}
        data-slot="tab-strip-list"
        hideScrollbars
        radius="none"
        ref={listRef}
        scrollFade
      >
        <div className="flex h-full w-max min-w-full items-center gap-1">{children}</div>
      </ScrollArea>
      <div
        className={cn("flex flex-auto shrink-0 items-center gap-1", dragRegion && "drag-region")}
        data-slot="tab-strip-end"
      >
        {action}
        {hidden.length > 0 ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={hiddenTabsLabel(hidden.length)}
                  data-slot="tab-strip-more"
                  size="xs"
                  variant="ghost"
                />
              }
            >
              {`${hidden.length} more`}
              <ChevronDownIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="end" side="bottom" sideOffset={6}>
              {hidden.map((item) => (
                <MenuItem key={item.id} onClick={() => onSelect(item.id)}>
                  {item.icon}
                  {item.label}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
    </div>
  );
}

const tabVariants = cva(
  "group/tab flex shrink-0 cursor-pointer items-center gap-1 rounded-md text-xs outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
  {
    defaultVariants: { size: "sm" },
    variants: {
      /** `sm`: a panel's strip of pages, 24 px; `md`: a page's own views, 28 px. */
      size: {
        sm: "h-6 max-w-36 px-1.5",
        md: "h-7 px-2.5 text-sm",
      },
    },
  },
);

interface TabProps extends useRender.ComponentProps<"div">, VariantProps<typeof tabVariants> {
  /** The item it stands for in its strip's `items`. */
  readonly tabId: string;
  readonly active: boolean;
}

/** One tab: filled while open, quiet otherwise, lit under the pointer. */
function Tab({ className, render, tabId, active, size, ...props }: TabProps) {
  const defaultProps = {
    className: cn(
      tabVariants({ size }),
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      className,
    ),
    "data-slot": "tab",
    "data-tab-id": tabId,
    "data-active-tab": active ? "true" : "false",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { Tab, TabStrip, tabVariants };
export type { TabProps, TabStripItem, TabStripProps };
