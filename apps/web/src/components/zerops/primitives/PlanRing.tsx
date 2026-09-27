import { cn } from "~/lib/utils";

export type PlanRingSegmentState = "done" | "running" | "waiting";

export interface PlanRingSegment {
  readonly state: PlanRingSegmentState;
  /** Degrees clockwise from the top. */
  readonly from: number;
  readonly to: number;
}

/** Degrees left open between two segments, and at the top where the spine comes in. */
const GAP = 18;

/**
 * A working plan as a ring: one segment a step, the ones done full, the one
 * running at half strength, the rest a faint track. It fills a step at a time
 * — the server reports steps, not progress within one, and a segment that
 * crept along would be drawing something nobody measured.
 */
export function planRingSegments(completed: number, total: number): ReadonlyArray<PlanRingSegment> {
  if (total <= 0) return [];
  if (total === 1) return [{ state: completed >= 1 ? "done" : "running", from: 0, to: 360 }];
  const span = 360 / total;
  return Array.from({ length: total }, (_, index) => ({
    state: index < completed ? "done" : index === completed ? "running" : "waiting",
    from: index * span + GAP / 2,
    to: (index + 1) * span - GAP / 2,
  }));
}

const CENTRE = 18;
const RADIUS = 16.75;

function point(degrees: number): string {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return `${(CENTRE + RADIUS * Math.cos(radians)).toFixed(2)} ${(CENTRE + RADIUS * Math.sin(radians)).toFixed(2)}`;
}

function arc({ from, to }: PlanRingSegment): string {
  if (to - from >= 360) {
    return `M${point(0)} A${RADIUS} ${RADIUS} 0 1 1 ${point(180)} A${RADIUS} ${RADIUS} 0 1 1 ${point(360)}`;
  }
  return `M${point(from)} A${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

const SEGMENT_CLASS: Record<PlanRingSegmentState, string> = {
  done: "stroke-status-busy",
  running: "stroke-status-busy/45",
  waiting: "stroke-status-busy/20",
};

/**
 * The ring a working Mate's face wears, 4px clear of it all round (36px
 * around a 28px face). Still, like the face: it changes when a step does,
 * never in between (R6). Decorative — the step it is on is the row's line.
 */
export function PlanRing({
  completed,
  total,
  className,
}: {
  readonly completed: number;
  readonly total: number;
  readonly className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none size-9 overflow-visible", className)}
      data-zerops-primitive="plan-ring"
      fill="none"
      viewBox="0 0 36 36"
    >
      {planRingSegments(completed, total).map((segment, index) => (
        <path
          className={SEGMENT_CLASS[segment.state]}
          d={arc(segment)}
          data-plan-ring-segment={segment.state}
          key={index}
          strokeLinecap="round"
          strokeWidth={1.75}
        />
      ))}
    </svg>
  );
}
