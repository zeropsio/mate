"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactElement, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * One row for every list: a leading mark (a Mate's face, a person, an icon), its title with the
 * badges after it and its meta at the end on one line, and at most one muted line under it. The
 * title holds its room: badges give way first, a whole badge at a time, and the title truncates
 * only once none is left. Meta is one line and never wraps.
 *
 * Sizes follow what the row leads with:
 * - `xs` — a tree's or a dense list's row: no mark or a 16 px one, caption words, 24 px tall;
 * - `sm` — a setting, an address: no mark or a 20 px one, 14 px words;
 * - `md` — a person, a service: a 32 px mark;
 * - `lg` — the menu's Mates and projects: a 36 px face, 15 px names and 14 px lines;
 * - `lg-line` — a one-line row among them: their 36 px column and 15 px names, one line tall;
 * - `bar` — the run card's line: a 28 px lead column (kept with no lead), 32 px tall, its title in
 *   the body's own ink and its meta (a time, a count) on the card's right edge.
 *
 * With `columns` the row is a list's line of cells instead (`RowColumns`).
 */
const rowVariants = cva("group/row relative flex min-w-0 gap-3 text-left outline-none", {
  defaultVariants: { size: "md", pressable: false, picked: false },
  variants: {
    size: {
      xs: "min-h-6 gap-2 rounded-control px-1.5 py-0.5",
      sm: "min-h-11 rounded-lg px-3 py-2.5",
      md: "min-h-12 rounded-xl px-2.5 py-2",
      lg: "min-h-15.75 rounded-xl px-2.5 py-2.75",
      "lg-line": "min-h-12 rounded-xl px-2.5 py-1.5",
      bar: "min-h-8 w-full gap-2 rounded-lg pe-3.5",
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
    /** Picked among its list (a take on the stage): it stands on the accent ground. */
    picked: {
      true: "bg-accent/70",
      false: "",
    },
  },
  compoundVariants: [
    // On the run card's tray the line lights as quietly as the card's other lines.
    {
      size: "bar",
      pressable: true,
      className: "hover:bg-foreground/4 focus-visible:ring-inset",
    },
  ],
});

type RowSize = NonNullable<VariantProps<typeof rowVariants>["size"]>;

const LEAD_CLASS: Record<RowSize, string> = {
  xs: "size-4",
  sm: "size-5",
  md: "size-8",
  lg: "size-9",
  "lg-line": "size-9",
  bar: "w-7",
};

const HEAD_CLASS: Record<RowSize, string> = {
  xs: "h-5 text-caption leading-5",
  sm: "h-5 text-body leading-5",
  md: "h-5 text-body leading-5",
  lg: "h-5.5 text-[15px] leading-5.25",
  "lg-line": "h-5.5 text-[15px] leading-5.25",
  bar: "min-h-5 text-body leading-5",
};

const BADGES_CLASS: Record<RowSize, string> = {
  xs: "h-5",
  sm: "h-5",
  md: "h-5",
  lg: "h-5.5",
  "lg-line": "h-5.5",
  bar: "h-5",
};

const LINE_CLASS: Record<RowSize, string> = {
  xs: "text-caption leading-4",
  sm: "text-caption leading-4",
  md: "text-line leading-5",
  lg: "text-prose leading-5.5",
  "lg-line": "text-prose leading-5.5",
  bar: "text-caption leading-4",
};

interface RowSlotsProps
  extends
    Omit<useRender.ComponentProps<"div">, "title" | "children">,
    VariantProps<typeof rowVariants> {
  readonly columns?: false;
  /** A Mate's face, a person, an icon: what the row is, at the size the row's `size` holds. */
  readonly lead?: ReactNode;
  /** The lead is a picture, not a mark: a 52 × 32 slot (a desktop's shape), its picture centred. */
  readonly thumbnail?: boolean;
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

function RowSlots({
  columns: _slots,
  className,
  render,
  size = "md",
  pressable,
  picked,
  lead,
  thumbnail = false,
  title,
  strong = false,
  badges,
  meta,
  line,
  lineWraps = false,
  control,
  ...props
}: RowSlotsProps) {
  const lined = line !== undefined && line !== null && line !== false;
  const rowSize = size ?? "md";
  const hasControl = control !== undefined && control !== null;
  // A bar keeps its lead column with nothing in it, so its words stand in the card's grid.
  const hasLead = (lead !== undefined && lead !== null) || rowSize === "bar";
  const defaultProps = {
    className: cn(
      rowVariants({ size: rowSize, pressable, picked }),
      // The mark stands on the title's line however many lines follow; a one-line row centres it.
      lined || rowSize === "lg" ? "items-start" : "items-center",
      // A control that leaves the words less than 12rem goes under them, at the row's end.
      hasControl && "flex-wrap",
      className,
    ),
    "data-slot": "row",
    children: (
      <>
        {hasLead ? (
          <span
            className={cn(
              "relative flex shrink-0 items-center justify-center",
              thumbnail ? "h-8 w-13" : LEAD_CLASS[rowSize],
            )}
            data-slot="row-lead"
          >
            {lead}
          </span>
        ) : null}
        <span
          className={cn("flex min-w-0 flex-1 flex-col", hasControl && "basis-48")}
          data-slot="row-body"
        >
          <span className={cn("flex min-w-0 items-center gap-2", HEAD_CLASS[rowSize])}>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "block min-w-0 max-w-full flex-none truncate text-foreground",
                  // A bar's title is a line of words in their own inks and weights.
                  strong ? "font-semibold" : rowSize === "bar" ? "" : "font-medium",
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
                className={cn(
                  "flex shrink-0 items-center whitespace-nowrap text-muted-foreground tabular-nums",
                  rowSize === "bar" ? "text-body" : "text-caption",
                )}
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

/**
 * A list's line of cells (`Row columns`): the row spans its list's grid and its cells stand in the
 * list's columns (`subgrid`), so the facts of every row run down the list in columns, each as wide
 * as the widest. The list places the cells and sets the row's room (`--row-pad-y`, `--row-pad-x`).
 */
const rowColumnsVariants = cva(
  "group/row col-span-full grid grid-cols-subgrid items-start text-left outline-none",
  {
    defaultVariants: { pressable: false, ground: "none" },
    variants: {
      /** As a slotted row's: `true` lights its own ground; `band` leaves that to its list. */
      pressable: {
        true: "cursor-pointer transition-colors duration-150 ease-out-strong hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
        band: "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
        false: "",
      },
      /**
       * `tint`: set apart on a ground of the mark's teal, deeper under the pointer and the menu's
       * lit ground while open (`aria-current="page"`) or pressed — the organization's own Mate at the
       * menu's top. Its ground is `--row-ground`, for a mark ringed in it.
       */
      ground: {
        none: "rounded-lg px-(--row-pad-x) py-(--row-pad-y)",
        tint: "relative isolate rounded-card bg-(--row-ground) transition-colors duration-150 ease-out-strong [--row-ground:color-mix(in_oklab,var(--zerops-mate-mark-side)_8%,var(--sidebar))] hover:[--row-ground:color-mix(in_oklab,var(--zerops-mate-mark-side)_13%,var(--sidebar))] aria-[current=page]:[--row-ground:var(--sidebar-row-active)] data-pressed:[--row-ground:var(--sidebar-row-active)] motion-reduce:transition-none",
      },
    },
  },
);

interface RowColumnsProps
  extends Omit<useRender.ComponentProps<"div">, "title">, VariantProps<typeof rowColumnsVariants> {
  readonly columns: true;
  /** The row's cells, each placed in its list's columns by the list. */
  readonly children: ReactNode;
}

function RowColumns({
  columns: _columns,
  className,
  render,
  pressable,
  ground,
  ...props
}: RowColumnsProps) {
  const defaultProps = {
    className: cn(rowColumnsVariants({ pressable, ground }), className),
    "data-slot": "row",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

// The slotted form is the last overload: it is the one `ComponentProps<typeof Row>` names.
function Row(props: RowColumnsProps): ReactElement;
function Row(props: RowSlotsProps): ReactElement;
function Row(props: RowSlotsProps | RowColumnsProps): ReactElement {
  return props.columns === true ? <RowColumns {...props} /> : <RowSlots {...props} />;
}

export { Row };
