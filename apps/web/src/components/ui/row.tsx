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
      sm: "min-h-11 rounded-control px-3 py-2.5",
      md: "min-h-12 rounded-card px-2.5 py-2",
      lg: "min-h-15.75 rounded-card px-2.5 py-2.75",
      "lg-line": "min-h-12 rounded-card px-2.5 py-1.5",
      bar: "min-h-8 w-full gap-2 rounded-control pe-3.5",
    },
    /**
     * The whole row opens or picks something: `true` lights its own ground (`bg-item-hover`) under
     * the pointer and while `data-highlighted` (a list's arrow keys stepping through rows that keep
     * focus on the list, a search field's results); `band` leaves that to its list, whose one band
     * slides to the row lit (the menu).
     */
    pressable: {
      true: "w-full cursor-pointer select-none transition-colors duration-150 ease-out-strong not-aria-disabled:[:hover,[data-highlighted]]:bg-item-hover focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default motion-reduce:transition-none",
      band: "w-full cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default",
      false: "",
    },
    /**
     * The one picked among its list, the one it shows (the tab open, the take on stage, the
     * conversation in view): it stands on `bg-item-picked`, and stays on it under the pointer. A
     * choice of a value says so with its own mark instead (`RadioRow`, a check box).
     */
    picked: {
      true: "bg-item-picked",
      false: "",
    },
  },
  compoundVariants: [
    {
      pressable: true,
      picked: true,
      className: "not-aria-disabled:[:hover,[data-highlighted]]:bg-item-picked",
    },
    // On the run card's tray the line's keyboard ring stays inside the card.
    { size: "bar", pressable: true, className: "focus-visible:ring-inset" },
  ],
});

type RowSize = NonNullable<VariantProps<typeof rowVariants>["size"]>;

/**
 * The lead's room, and the size it gives an icon that says what the row is: 14 px in an `xs` row,
 * 16 px in every other, in the muted ink unless the icon names an ink that means something (the
 * primary ink of an add). An icon in a lead names no size of its own.
 */
const LEAD_CLASS: Record<RowSize, string> = {
  xs: "size-4 [&>svg:not([class*='size-'])]:size-3.5",
  sm: "size-5 [&>svg:not([class*='size-'])]:size-4",
  md: "size-8 [&>svg:not([class*='size-'])]:size-4",
  lg: "size-9 [&>svg:not([class*='size-'])]:size-4",
  "lg-line": "size-9 [&>svg:not([class*='size-'])]:size-4",
  bar: "w-7 [&>svg:not([class*='size-'])]:size-4",
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
  /**
   * A setting's row on a phone: its control stands on the title's line, and a field (a select,
   * an input, a slider) takes the row's width under the words, every select one height.
   */
  readonly fieldUnder?: boolean;
  /**
   * A short control (a two-way choice) that stays on the title's line however narrow the row:
   * the words truncate first. A person's access in a narrow picker.
   */
  readonly controlStays?: boolean;
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
  fieldUnder = false,
  controlStays = false,
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
      hasControl && !controlStays && "flex-wrap",
      className,
    ),
    "data-slot": "row",
    children: (
      <>
        {hasLead ? (
          <span
            className={cn(
              "relative flex shrink-0 items-center justify-center [&>svg:not([class*='text-'])]:text-muted-foreground",
              thumbnail ? "h-8 w-13" : LEAD_CLASS[rowSize],
            )}
            data-slot="row-lead"
          >
            {lead}
          </span>
        ) : null}
        <span
          className={cn("flex min-w-0 flex-1 flex-col", hasControl && !controlStays && "basis-48")}
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
            className={cn(
              "ms-auto flex shrink-0 items-center gap-2 self-center",
              fieldUnder &&
                "max-sm:self-start max-sm:has-[[data-slot=select-trigger],[data-slot=input-control],[data-slot=number-field],input[type=range]]:basis-full max-sm:**:data-[slot=select-trigger]:min-h-9",
            )}
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
    defaultVariants: { pressable: false, picked: false, ground: "none" },
    variants: {
      /** As a slotted row's: `true` lights its own ground (`bg-item-hover`); `band` leaves that to its list. */
      pressable: {
        true: "cursor-pointer transition-colors duration-150 ease-out-strong [:hover,:focus-visible,[data-highlighted]]:bg-item-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
        band: "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
        false: "",
      },
      /**
       * As a slotted row's: the one its list shows now (the task open in its panel) stands on
       * `bg-item-picked`, and stays on it under the pointer and the keyboard's cursor.
       */
      picked: {
        true: "bg-item-picked",
        false: "",
      },
      /**
       * `menu`: a Mate row's grounds outside the menu's list — its own ground at rest, a row's hover
       * under the pointer and the lit ground while open (`aria-current="page"`) or pressed; the
       * organization's own Mate at the list's top. Its ground is `--row-ground`, for a mark ringed
       * in it.
       */
      ground: {
        none: "rounded-control px-(--row-pad-x) py-(--row-pad-y)",
        menu: "relative isolate rounded-card transition-colors duration-150 ease-out-strong [--row-ground:var(--sidebar)] [:hover,[aria-current=page],[data-pressed]]:bg-(--row-ground) hover:[--row-ground:var(--sidebar-row-hover)] aria-[current=page]:[--row-ground:var(--sidebar-row-active)] data-pressed:[--row-ground:var(--sidebar-row-active)] motion-reduce:transition-none",
      },
    },
    compoundVariants: [
      {
        pressable: true,
        picked: true,
        className: "[:hover,:focus-visible,[data-highlighted]]:bg-item-picked",
      },
    ],
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
  picked,
  ground,
  ...props
}: RowColumnsProps) {
  const defaultProps = {
    className: cn(rowColumnsVariants({ pressable, picked, ground }), className),
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
