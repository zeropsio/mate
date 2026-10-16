"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";

import { Button } from "./button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";
import { ScrollArea } from "./scroll-area";
import { hiddenTabsLabel, tabsCompact, tabsOutOfView } from "./tabStrip.logic";

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

/** Whether the strip folds the tabs other than the open one to their icons (`tabsCompact`). */
const TabStripCompactContext = createContext(false);

/** Inside a `TabStrip`: whether its tabs other than the open one show only their icons. */
function useTabStripCompact(): boolean {
  return useContext(TabStripCompactContext);
}

/** The open tab, clear of the strip's faded edges. */
function revealTab(list: HTMLElement | null, activeId: string | null) {
  if (activeId === null) return;
  Array.from(list?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])
    .find((tab) => tab.dataset.tabId === activeId)
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * A row of tabs that scrolls sideways when there are more than its room holds. Once every name no
 * longer fits, the tabs other than the open one fold to their icons, their names in tooltips; the
 * tabs its edges still cut off are listed in a "N more" menu beside it, and its action (open
 * another, add one) stands after the tabs, outside the scroll, so neither ever scrolls out of
 * reach. The open tab is kept in view when it changes and whenever the strip's room changes.
 */
function TabStrip({ items, activeId, onSelect, action, children, dragRegion }: TabStripProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLSpanElement | null>(null);
  const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);
  const [compact, setCompact] = useState(false);
  const revealActive = useEffectEvent(() => revealTab(listRef.current, activeId));
  /** Each tab's width as last measured with its name shown: a folded tab keeps its named width. */
  const namedWidths = useRef(new Map<string, number>());

  useEffect(() => {
    // After the strip's first layout: on mount its viewport has no width to scroll in yet.
    const frame = requestAnimationFrame(() => revealTab(listRef.current, activeId));
    return () => cancelAnimationFrame(frame);
  }, [activeId]);

  // The tabs the strip's edges cut off, re-read as it scrolls or resizes; on a resize (a tab
  // opened or closed, the "N more" menu appearing, the panel resized) the open tab is kept in view.
  useEffect(() => {
    const viewport = listRef.current?.querySelector<HTMLElement>(
      "[data-slot='scroll-area-viewport']",
    );
    if (!viewport) return;
    const fold = () => {
      const tabs = Array.from(viewport.querySelectorAll<HTMLElement>("[data-tab-id]"));
      for (const tab of tabs) {
        if (tab.dataset.tabCompact !== "true") {
          namedWidths.current.set(tab.dataset.tabId ?? "", tab.getBoundingClientRect().width);
        }
      }
      const root = rootRef.current?.getBoundingClientRect().width ?? 0;
      const actionWidth = actionRef.current?.getBoundingClientRect().width ?? 0;
      setCompact(
        tabsCompact({
          room: root - (actionRef.current === null ? 0 : actionWidth + TAB_STRIP_GAP),
          widths: tabs.map((tab) => namedWidths.current.get(tab.dataset.tabId ?? "") ?? 0),
        }),
      );
    };
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
    const resized = () => {
      fold();
      measure();
      revealActive();
    };
    resized();
    const observer = new ResizeObserver(resized);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    if (rootRef.current) observer.observe(rootRef.current);
    viewport.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, []);

  const hidden = items.filter((item) => hiddenIds.includes(item.id));
  return (
    <TabStripCompactContext.Provider value={compact}>
      <div className="flex min-w-0 flex-1 items-center gap-1" data-slot="tab-strip" ref={rootRef}>
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
          {action === undefined || action === null ? null : (
            <span
              className="flex shrink-0 items-center"
              data-slot="tab-strip-action"
              ref={actionRef}
            >
              {action}
            </span>
          )}
          {hidden.length > 0 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label={hiddenTabsLabel(hidden.length)}
                    data-slot="tab-strip-more"
                    size="sm"
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
    </TabStripCompactContext.Provider>
  );
}

/** The room between the strip's tabs and its action (`gap-1`). */
const TAB_STRIP_GAP = 4;

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
  const compact = useTabStripCompact() && !active;
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
    "data-tab-compact": compact ? "true" : "false",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { Tab, TabStrip, tabVariants, useTabStripCompact };
export type { TabProps, TabStripItem, TabStripProps };
