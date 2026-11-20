import type { MateTintId } from "@t3tools/shared/brand";
import { formatRunClock } from "@t3tools/client-runtime/zerops";
import { cn } from "~/lib/utils";
import { useSecondsNowMs } from "~/zerops/useNowMs";

/**
 * The working clock, ticking once a second — a step, never a continuous repaint (R6) — read as a
 * live clock, not a timestamp (the owner, 2026-09-30): 600 and tabular in its Mate's own hue,
 * after a small dot of the same hue breathing slowly. The dot stands outside the clock's box, in
 * the gap before it, so nothing beside it moves; reduced motion holds it still.
 */
export function MateWorkingTime({
  since,
  tint,
  className,
}: {
  readonly since: string;
  readonly tint: MateTintId;
  readonly className?: string | undefined;
}) {
  const nowMs = useSecondsNowMs(true);
  return (
    <span
      className={cn("menu-clock menu-time shrink-0 tabular-nums", className)}
      data-tint={tint}
      data-zerops-surface="sidebar-mate-time"
    >
      <span aria-hidden="true" className="menu-clock-mark" />
      {formatRunClock(nowMs - Date.parse(since))}
    </span>
  );
}
