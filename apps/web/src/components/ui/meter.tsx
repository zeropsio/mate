import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

const METER_SIZE = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-3",
} as const;

const METER_TONE = {
  neutral: "bg-muted-foreground/70",
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-status-ok",
  warning: "bg-status-attention",
  danger: "bg-status-failed",
} as const;

export type MeterTone = keyof typeof METER_TONE;

/**
 * One quantity against its limit, as a filled track: a service's RAM of what it holds, a context
 * window's tokens of its size, a quota's share left. `value` is the share filled, 0 to 1 (clamped).
 *
 * - `size`: `sm` 4 px inside a row or a popup's line, `md` 6 px where the bar stands beside its
 *   figure in a list, `lg` 12 px where the bar is the subject (a quota's window).
 * - `tone`: what the fill means. `primary` for work under way (Progress), `neutral` for a plain
 *   amount, `info` for a measured resource, `success` for done or healthy, `warning` for nearly
 *   full, `danger` for over or failed. The caller owns the threshold that turns a tone, so the
 *   verdict is computed once, where its rule lives.
 * - `color`: a series' own colour in place of a tone, for a bar that stands for one series of a
 *   chart (a coding agent, compute spend): `var(--color-series-1)`, `var(--color-agent-claude)`.
 * - `marker`: a hairline across the track at that share, 0 to 1: where even pacing would be.
 * - `label`: names the meter for assistive technology; without one it is decoration (`aria-hidden`)
 *   and its figure must be said in words beside it.
 *
 * The fill slides in from the start, never resizes, so a change costs the compositor only.
 */
function Meter({
  value,
  size = "sm",
  tone = "neutral",
  color,
  marker,
  label,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "color"> & {
  readonly value: number;
  readonly size?: keyof typeof METER_SIZE;
  readonly tone?: MeterTone;
  readonly color?: string | undefined;
  readonly marker?: number | null | undefined;
  readonly label?: string | undefined;
}) {
  const share = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const markAt =
    marker === null || marker === undefined || !Number.isFinite(marker)
      ? null
      : Math.min(1, Math.max(0, marker));
  return (
    <div
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      aria-valuemax={label === undefined ? undefined : 100}
      aria-valuemin={label === undefined ? undefined : 0}
      aria-valuenow={label === undefined ? undefined : Math.round(share * 100)}
      className={cn("relative w-full min-w-0", METER_SIZE[size], className)}
      data-slot="meter"
      data-tone={color === undefined ? tone : undefined}
      role={label === undefined ? undefined : "meter"}
      {...props}
    >
      <div className="size-full overflow-hidden rounded-full bg-muted-foreground/15">
        <div
          className={cn(
            "size-full rounded-full transition-transform duration-260 ease-out-strong motion-reduce:transition-none",
            color === undefined && METER_TONE[tone],
          )}
          data-slot="meter-fill"
          style={{
            transform: `translateX(${String((share - 1) * 100)}%)`,
            ...(color === undefined ? {} : { backgroundColor: color }),
          }}
        />
      </div>
      {markAt === null ? null : (
        <span
          aria-hidden="true"
          className="absolute -inset-y-1 w-px -translate-x-1/2 bg-foreground/60"
          data-slot="meter-marker"
          style={{ left: `${String(markAt * 100)}%` }}
        />
      )}
    </div>
  );
}

export { Meter };
