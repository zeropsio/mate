"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Dot } from "./dot";

/**
 * The one label: a short word or count beside the thing it describes. A pill on the status
 * surfaces, so it never reads as a press (a press is a Button, a rectangle). Five tones carry
 * meaning, never decoration: `neutral` for a fact, `info` for work under way, `success` for
 * done or running, `warning` for what needs the person, `danger` for what broke and for
 * Production. The neutral pill's ground is a step of the ink, so it shows on the page, a card
 * and a tinted tray alike. A number is the `count` form: a compact pill beside a title, a row or
 * a menu's group (how many changes, how many working), or on a control's corner with `corner`,
 * solid there since it stands over an icon, cut out of `--mark-ground` like a corner `Dot`. The dot form is a `Dot` before its words.
 */
const badgeVariants = cva(
  "relative inline-flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { tone: "neutral", form: "pill", corner: false },
    variants: {
      form: {
        pill: "h-5 overflow-hidden rounded-full px-2 font-medium text-caption",
        // A number: as tall as a dense line, never narrower than it is tall, its figures even.
        count:
          "h-4 min-w-4 justify-center overflow-hidden rounded-full px-1.5 font-semibold text-2xs tabular-nums",
        // The dot form takes the size and ink of the words around it, 8 px from them.
        dot: "gap-2",
      },
      tone: {
        neutral: "",
        info: "",
        success: "",
        warning: "",
        danger: "",
      },
      // A count on a control's corner, cut out of the ground it sits on.
      corner: {
        false: "",
        true: "absolute -end-1.5 -top-1.5 ring-2 ring-(--mark-ground,var(--color-background))",
      },
    },
    compoundVariants: [
      { form: "pill", tone: "neutral", className: "bg-foreground/6 text-foreground" },
      // A number is quieter than the title it counts for: the neutral count in the muted ink.
      {
        form: "count",
        corner: false,
        tone: "neutral",
        className: "bg-foreground/6 text-muted-foreground",
      },
      {
        form: "count",
        corner: false,
        tone: "info",
        className: "bg-status-busy-surface text-status-busy-text",
      },
      {
        form: "count",
        corner: false,
        tone: "success",
        className: "bg-status-ok-surface text-status-ok-text",
      },
      {
        form: "count",
        corner: false,
        tone: "warning",
        className: "bg-status-attention-surface text-status-attention-text",
      },
      {
        form: "count",
        corner: false,
        tone: "danger",
        className: "bg-status-failed-surface text-status-failed-text",
      },
      // On a corner it stands over an icon, so it is solid: the tone's fill, white figures.
      {
        form: "count",
        corner: true,
        tone: "neutral",
        className: "bg-muted-foreground text-background",
      },
      { form: "count", corner: true, tone: "info", className: "bg-status-busy text-fill-ink" },
      { form: "count", corner: true, tone: "success", className: "bg-status-ok text-fill-ink" },
      {
        form: "count",
        corner: true,
        tone: "warning",
        className: "bg-status-attention text-fill-ink",
      },
      { form: "count", corner: true, tone: "danger", className: "bg-status-failed text-fill-ink" },
      { form: "pill", tone: "info", className: "bg-status-busy-surface text-status-busy-text" },
      { form: "pill", tone: "success", className: "bg-status-ok-surface text-status-ok-text" },
      {
        form: "pill",
        tone: "warning",
        className: "bg-status-attention-surface text-status-attention-text",
      },
      {
        form: "pill",
        tone: "danger",
        className: "bg-status-failed-surface text-status-failed-text",
      },
    ],
  },
);

/**
 * A door: a pill that opens what it names (a menu row's environment tag, a project's release
 * mark). It stays a pill, never a Button's rectangle; its hairline firms in its own ink under the
 * pointer and while what it opens is open — on itself, or on the bare press around it.
 */
const DOOR =
  "cursor-pointer transition-shadow duration-150 ease-out-strong hover:inset-ring-1 hover:inset-ring-current/30 data-popup-open:inset-ring-1 data-popup-open:inset-ring-current/30 [:hover>&]:inset-ring-1 [:hover>&]:inset-ring-current/30 [[data-popup-open]>&]:inset-ring-1 [[data-popup-open]>&]:inset-ring-current/30 motion-reduce:transition-none";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

type BadgeProps = Omit<useRender.ComponentProps<"span">, "children"> & {
  readonly tone?: BadgeTone;
  /** The one size: 20 px, caption type. */
  readonly size?: "sm";
  /** A pill that opens what it names (`DOOR`). */
  readonly door?: boolean;
} & (
    | {
        readonly dot?: false;
        readonly pulse?: never;
        readonly count?: false;
        readonly children: ReactNode;
      }
    | {
        readonly dot?: false;
        readonly pulse?: never;
        readonly door?: never;
        /** A number: the compact pill, its figures even. */
        readonly count: true;
        /** On its positioned parent's top-end corner, cut out of `--mark-ground`. */
        readonly corner?: boolean;
        readonly children: ReactNode;
      }
    | {
        /** An 8 px status dot before its words; without words it needs an `aria-label`. */
        readonly dot: true;
        /** The dot breathes while the work it marks runs (`info`'s default). */
        readonly pulse?: boolean;
        /** Only the dot's ring: nothing there yet (a place with no deploy), or at rest on purpose. */
        readonly hollow?: boolean;
        /**
         * The words wrap instead of truncating, the dot on their first line: a status said as a
         * sentence (a failure in its source's words) is never cut.
         */
        readonly wrap?: boolean;
        readonly children: ReactNode;
      }
    | {
        readonly dot: true;
        readonly pulse?: boolean;
        readonly hollow?: boolean;
        readonly children?: undefined;
        readonly "aria-label": string;
      }
  );

function Badge({
  className,
  tone = "neutral",
  size: _size,
  door = false,
  dot,
  pulse,
  render,
  ...props
}: BadgeProps) {
  const wraps = "wrap" in props && props.wrap === true;
  const hollow = "hollow" in props && props.hollow === true;
  const counts = "count" in props && props.count === true;
  const cornered = counts && "corner" in props && props.corner === true;
  const form = dot === true ? "dot" : counts ? "count" : "pill";
  const breathes = dot === true && !hollow && (pulse ?? tone === "info");
  const labelled = dot === true && props.children === undefined;
  const mark = hollow ? <Dot hollow tone={tone} /> : <Dot pulse={breathes} tone={tone} />;
  const defaultProps = {
    className: cn(
      badgeVariants({ form, tone, corner: cornered }),
      wraps && "shrink items-start whitespace-normal",
      door && DOOR,
      className,
    ),
    "data-slot": "badge",
    "data-tone": tone,
    "data-dot": dot === true ? "" : undefined,
    ...(labelled ? { role: "img" } : {}),
    children:
      dot === true ? (
        <>
          {wraps ? (
            <span aria-hidden="true" className="flex h-lh shrink-0 items-center">
              {mark}
            </span>
          ) : (
            mark
          )}
          {props.children === undefined ? null : (
            <span className={wraps ? "min-w-0" : "min-w-0 truncate"}>{props.children}</span>
          )}
        </>
      ) : (
        props.children
      ),
  };
  const { children: _children, ...given } = props;
  const {
    wrap: _wrap,
    hollow: _hollow,
    count: _count,
    corner: _corner,
    ...rest
  } = given as typeof given & {
    readonly wrap?: boolean;
    readonly hollow?: boolean;
    readonly count?: boolean;
    readonly corner?: boolean;
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, rest),
    render,
  });
}

// The *Variants function is for components/ui modules only.
export { Badge, type BadgeTone };
