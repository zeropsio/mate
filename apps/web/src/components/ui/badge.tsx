"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The one label: a short word or count beside the thing it describes. A pill on the status
 * surfaces, so it never reads as a press (a press is a Button, a rectangle). Five tones carry
 * meaning, never decoration: `neutral` for a fact, `info` for work under way, `success` for
 * done or running, `warning` for what needs the person, `danger` for what broke.
 */
const badgeVariants = cva(
  "relative inline-flex min-w-0 shrink-0 items-center gap-1 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { tone: "neutral", form: "pill" },
    variants: {
      form: {
        pill: "h-5 overflow-hidden rounded-full px-2 font-medium text-caption",
        // The dot form takes the size and ink of the words around it.
        dot: "gap-1.5",
      },
      tone: {
        neutral: "",
        info: "",
        success: "",
        warning: "",
        danger: "",
      },
    },
    compoundVariants: [
      { form: "pill", tone: "neutral", className: "bg-status-off-surface text-foreground" },
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

const DOT_TONE = {
  neutral: "bg-status-off",
  info: "bg-status-busy",
  success: "bg-status-ok",
  warning: "bg-status-attention",
  danger: "bg-status-failed",
} as const;

type BadgeTone = keyof typeof DOT_TONE;

type BadgeProps = Omit<useRender.ComponentProps<"span">, "children"> & {
  readonly tone?: BadgeTone;
  /** The one size: 20 px, caption type. */
  readonly size?: "sm";
} & (
    | { readonly dot?: false; readonly pulse?: never; readonly children: ReactNode }
    | {
        /** An 8 px status dot before its words; without words it needs an `aria-label`. */
        readonly dot: true;
        /** The dot breathes while the work it marks runs (`info`'s default). */
        readonly pulse?: boolean;
        readonly children: ReactNode;
      }
    | {
        readonly dot: true;
        readonly pulse?: boolean;
        readonly children?: undefined;
        readonly "aria-label": string;
      }
  );

function Badge({
  className,
  tone = "neutral",
  size: _size,
  dot,
  pulse,
  render,
  ...props
}: BadgeProps) {
  const form = dot === true ? "dot" : "pill";
  const breathes = dot === true && (pulse ?? tone === "info");
  const labelled = dot === true && props.children === undefined;
  const defaultProps = {
    className: cn(badgeVariants({ form, tone }), className),
    "data-slot": "badge",
    "data-tone": tone,
    "data-dot": dot === true ? "" : undefined,
    ...(labelled ? { role: "img" } : {}),
    children:
      dot === true ? (
        <>
          <span
            aria-hidden="true"
            data-pulse={breathes ? "" : undefined}
            className={cn(
              "inline-flex size-2 shrink-0 rounded-full",
              DOT_TONE[tone],
              breathes && "animate-status-pulse motion-reduce:animate-none",
            )}
          />
          {props.children === undefined ? null : (
            <span className="min-w-0 truncate">{props.children}</span>
          )}
        </>
      ) : (
        props.children
      ),
  };
  const { children: _children, ...rest } = props;

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, rest),
    render,
  });
}

// The *Variants function is for components/ui modules only.
export { Badge, badgeVariants, type BadgeTone };
