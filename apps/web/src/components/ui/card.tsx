"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * One card. `flat` is the app's: a hairline and the card ground, no shadow; `inset` is a card
 * inside another (a well set into its surface), set apart by a step of the ink under it instead of
 * a second border — depth shows as tint, on a page, a card and a tray alike; `sheet` is a card that
 * stands alone as its own surface, side by side with its kind (the overview's project cards): the
 * default card at the sheet's radius; `slot` is the place a thing will stand before it is there (a
 * service the setup declares and Zerops lacks, a section with nothing yet): a dashed hairline and
 * no ground of its own; `wash` is a card that stands out from its siblings by what it is, in a wash
 * of its tone with its hairline in it: the one next step on a surface (the default tone, the
 * primary's: what the person can act on), the Mate's own home (`ok`).
 * `size` is its padding when its content is not rows that carry their own: `sm` for a card in a
 * list or a conversation, `md` for a card that stands alone on a page; `rows` is a card of rows
 * that light their own ground, 6 px around them so a lit row's corner sits inside the card's.
 * `pressable` makes the whole card one press. `tone` is the state of what it holds, worn by its
 * hairline: `ok` running or done, `busy` under way, `attention` waiting on the person, `failed`
 * a thing that broke (a tool call that failed); a `wash` card wears it as its ground too.
 */
const cardVariants = cva("", {
  defaultVariants: {
    variant: "default",
    size: "none",
    pressable: false,
    tone: "default",
  },
  variants: {
    variant: {
      default:
        "relative flex flex-col rounded-card border bg-card bg-clip-ground text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-card)-1px)] before:shadow-edge",
      flat: "relative flex flex-col rounded-card border border-[var(--zerops-flat-card-border)] bg-card text-card-foreground",
      inset: "relative flex flex-col rounded-control bg-foreground/4 text-card-foreground",
      sheet:
        "relative flex flex-col rounded-sheet border bg-card bg-clip-ground text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-sheet)-1px)] before:shadow-edge",
      slot: "relative flex flex-col rounded-card border border-dashed border-border",
      wash: "relative flex flex-col rounded-card border text-card-foreground",
    },
    size: {
      none: "",
      sm: "gap-2 px-3.5 py-3",
      md: "gap-3 p-4",
      rows: "p-1.5",
    },
    tone: {
      default: "",
      ok: "border-status-ok/35",
      busy: "border-status-busy/35",
      attention: "border-status-attention/35",
      failed: "border-status-failed/35",
    },
    /**
     * A card whose whole body is one press (a launcher's page, a thing it opens): a `<button>`, or
     * a link through `render`. Lit under the pointer, by keyboard focus, and while `data-highlighted`
     * (a list's arrow keys stepping through cards that keep focus on the list): it keeps its own
     * ground and the item's hover step (`--color-item-hover`) lies over it, an inset shade, so a
     * card lights like every pressable item, on a page, a card and a tray alike.
     */
    pressable: {
      true: "cursor-pointer text-start outline-none transition-[background-color,box-shadow] duration-150 ease-out-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [:hover,:focus-visible,[data-highlighted]]:inset-shadow-[0_0_0_100vmax_var(--color-item-hover)]",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "wash", tone: "default", className: "border-primary/20 bg-primary/6" },
    { variant: "wash", tone: "ok", className: "border-status-ok/20 bg-status-ok-surface" },
    { variant: "wash", tone: "busy", className: "border-status-busy/20 bg-status-busy-surface" },
    {
      variant: "wash",
      tone: "attention",
      className: "border-status-attention/20 bg-status-attention-surface",
    },
    {
      variant: "wash",
      tone: "failed",
      className: "border-status-failed/20 bg-status-failed-surface",
    },
  ],
});

interface CardProps extends useRender.ComponentProps<"div"> {
  variant?: VariantProps<typeof cardVariants>["variant"];
  size?: VariantProps<typeof cardVariants>["size"];
  pressable?: boolean;
  tone?: VariantProps<typeof cardVariants>["tone"];
}

function Card({ className, render, variant, size, pressable = false, tone, ...props }: CardProps) {
  const defaultProps = {
    className: cn(cardVariants({ className, variant, size, pressable, tone })),
    "data-slot": "card",
    ...(pressable && render === undefined ? { type: "button" as const } : {}),
  };

  return useRender({
    defaultTagName: pressable ? "button" : "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrame({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "[--clip-top:-1rem] [--clip-bottom:-1rem] *:data-[slot=card]:first:[--clip-top:1px] *:data-[slot=card]:last:[--clip-bottom:1px] flex flex-col relative rounded-card border bg-card before:bg-muted/72 bg-clip-ground text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-card)-1px)] before:shadow-edge *:data-[slot=card]:-m-px *:not-last:data-[slot=card]:rounded-b-control *:not-last:data-[slot=card]:before:rounded-b-[calc(var(--radius-control)-1px)] *:not-first:data-[slot=card]:rounded-t-control *:not-first:data-[slot=card]:before:rounded-t-[calc(var(--radius-control)-1px)] *:data-[slot=card]:[clip-path:inset(var(--clip-top)_1px_var(--clip-bottom)_1px_round_calc(var(--radius-card)-1px))] *:data-[slot=card]:shadow-none *:data-[slot=card]:before:hidden *:data-[slot=card]:bg-clip-padding",
      className,
    ),
    "data-slot": "card-frame",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameHeader({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("relative flex flex-col px-6 py-4", className),
    "data-slot": "card-frame-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameTitle({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("font-semibold text-body", className),
    "data-slot": "card-frame-title",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameDescription({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("text-muted-foreground text-body", className),
    "data-slot": "card-frame-description",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameFooter({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("px-6 py-4", className),
    "data-slot": "card-frame-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardHeader({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 p-6 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pb-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
      className,
    ),
    "data-slot": "card-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardTitle({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("font-semibold text-emphasis leading-none", className),
    "data-slot": "card-title",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardDescription({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("text-muted-foreground text-body", className),
    "data-slot": "card-description",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardAction({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "col-start-2 row-span-2 row-start-1 self-start justify-self-end inline-flex",
      className,
    ),
    "data-slot": "card-action",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardPanel({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex-1 p-6 in-[[data-slot=card]:has(>[data-slot=card-header]:not(.border-b))]:pt-0 in-[[data-slot=card]:has(>[data-slot=card-footer]:not(.border-t))]:pb-0",
      className,
    ),
    "data-slot": "card-panel",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFooter({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex items-center p-6 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pt-4",
      className,
    ),
    "data-slot": "card-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export {
  Card,
  CardFrame,
  CardFrameHeader,
  CardFrameTitle,
  CardFrameDescription,
  CardFrameFooter,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
};
