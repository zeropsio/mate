"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * One row for every list: a leading mark (a Mate's face, a person, an icon), its title with the
 * badges after it and its meta at the end on one line, and at most one muted line under it. The
 * title holds its room: badges give way first, a whole badge at a time, and the title truncates
 * only once none is left. Meta is one line and never wraps.
 *
 * Sizes follow what the row leads with:
 * - `sm` — a setting, an address: no mark or a 20 px one, 14 px words;
 * - `md` — a person, a service: a 32 px mark;
 * - `lg` — the menu's Mates and projects: a 36 px face, 15 px names and 14 px lines.
 */
const rowVariants = cva("group/row relative flex min-w-0 gap-3 text-left outline-none", {
  defaultVariants: { size: "md", pressable: false },
  variants: {
    size: {
      sm: "min-h-11 rounded-lg px-3 py-2.5",
      md: "min-h-12 rounded-xl px-2.5 py-2",
      lg: "min-h-15.75 rounded-xl px-2.5 py-2.75",
    },
    /**
     * The whole row opens something: `true` lights its own ground under the pointer; `band` leaves
     * that to its list, whose one band slides to the row lit (the menu).
     */
    pressable: {
      true: "w-full cursor-pointer select-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:hover:bg-transparent",
      band: "w-full cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default",
      false: "",
    },
  },
});

type RowSize = NonNullable<VariantProps<typeof rowVariants>["size"]>;

const LEAD_CLASS: Record<RowSize, string> = {
  sm: "size-5",
  md: "size-8",
  lg: "size-9",
};

const HEAD_CLASS: Record<RowSize, string> = {
  sm: "h-5 text-sm leading-5",
  md: "h-5 text-sm leading-5",
  lg: "h-5.5 text-[15px] leading-5.25",
};

const BADGES_CLASS: Record<RowSize, string> = {
  sm: "h-5",
  md: "h-5",
  lg: "h-5.5",
};

const LINE_CLASS: Record<RowSize, string> = {
  sm: "text-xs leading-4",
  md: "text-line leading-5",
  lg: "text-prose leading-5.5",
};

interface RowProps
  extends
    Omit<useRender.ComponentProps<"div">, "title" | "children">,
    VariantProps<typeof rowVariants> {
  /** A Mate's face, a person, an icon: what the row is, at the size the row's `size` holds. */
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  /** The title's weight while something on the row is unseen. */
  readonly strong?: boolean;
  /** Marks after the title that give way before it does, a whole one at a time. */
  readonly badges?: ReactNode;
  /** At the line's end: a time, a count, a state's word. One line, never wrapped. */
  readonly meta?: ReactNode;
  /** One muted line under the title; truncated unless `lineWraps`. */
  readonly line?: ReactNode;
  /** A setting's description: its whole sentence, wrapped. */
  readonly lineWraps?: boolean;
  /** A control at the row's end, centred on it: a switch, a select, a menu. */
  readonly control?: ReactNode;
}

function Row({
  className,
  render,
  size = "md",
  pressable,
  lead,
  title,
  strong = false,
  badges,
  meta,
  line,
  lineWraps = false,
  control,
  ...props
}: RowProps) {
  const lined = line !== undefined && line !== null && line !== false;
  const rowSize = size ?? "md";
  const hasControl = control !== undefined && control !== null;
  const defaultProps = {
    className: cn(
      rowVariants({ size: rowSize, pressable }),
      // The mark stands on the title's line however many lines follow; a one-line row centres it.
      lined || rowSize === "lg" ? "items-start" : "items-center",
      // A control that leaves the words less than 12rem goes under them, at the row's end.
      hasControl && "flex-wrap",
      className,
    ),
    "data-slot": "row",
    children: (
      <>
        {lead === undefined || lead === null ? null : (
          <span
            className={cn(
              "relative flex shrink-0 items-center justify-center",
              LEAD_CLASS[rowSize],
            )}
            data-slot="row-lead"
          >
            {lead}
          </span>
        )}
        <span
          className={cn("flex min-w-0 flex-1 flex-col", hasControl && "basis-48")}
          data-slot="row-body"
        >
          <span className={cn("flex min-w-0 items-center gap-2", HEAD_CLASS[rowSize])}>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "block min-w-0 max-w-full flex-none truncate text-foreground",
                  strong ? "font-semibold" : "font-medium",
                )}
                data-slot="row-title"
              >
                {title}
              </span>
              {badges === undefined || badges === null ? null : (
                <span
                  className={cn(
                    // One line tall: a badge that does not fit wraps under it, out of sight, whole.
                    // The empty first item keeps even the first badge from holding the line alone.
                    "flex min-w-0 flex-auto flex-wrap content-start items-center gap-1.5 overflow-hidden *:shrink-0 before:block before:h-full before:w-0 before:-me-1.5",
                    BADGES_CLASS[rowSize],
                  )}
                  data-slot="row-badges"
                >
                  {badges}
                </span>
              )}
            </span>
            {meta === undefined || meta === null ? null : (
              <span
                className="flex shrink-0 items-center whitespace-nowrap text-muted-foreground text-xs tabular-nums"
                data-slot="row-meta"
              >
                {meta}
              </span>
            )}
          </span>
          {lined ? (
            <span
              className={cn(
                "min-w-0 text-muted-foreground",
                LINE_CLASS[rowSize],
                lineWraps ? "max-w-xl" : "truncate",
              )}
              data-slot="row-line"
            >
              {line}
            </span>
          ) : null}
        </span>
        {hasControl ? (
          <span
            className="ms-auto flex shrink-0 items-center gap-2 self-center"
            data-slot="row-control"
          >
            {control}
          </span>
        ) : null}
      </>
    ),
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { Row, rowVariants };
export type { RowProps, RowSize };
