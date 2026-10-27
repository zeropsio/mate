/**
 * A step's state as one mark, the same wherever steps are listed — a
 * deploy's pipeline, a card's steps, the task list: a ring in the state's
 * tone, what is inside it saying the state. The running one is the strongest
 * — the busy blue, stepping (R6) — so the eye finds where the work is; done
 * is a calm check, waiting an empty ring, failed a cross.
 */
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CircleMinusIcon,
  CircleXIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

export type StepGlyphState = "waiting" | "running" | "done" | "failed" | "stopped";

const GLYPH: Record<StepGlyphState, { readonly Icon: LucideIcon; readonly tone: string }> = {
  waiting: { Icon: CircleIcon, tone: "text-status-off" },
  running: { Icon: CircleDotIcon, tone: "text-status-busy" },
  done: { Icon: CircleCheckIcon, tone: "text-status-ok" },
  failed: { Icon: CircleXIcon, tone: "text-status-failed" },
  stopped: { Icon: CircleMinusIcon, tone: "text-status-off" },
};

export function StepGlyph({
  state,
  className,
}: {
  readonly state: StepGlyphState;
  readonly className?: string;
}) {
  const { Icon, tone } = GLYPH[state];
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        tone,
        state === "running" && "animate-status-pulse motion-reduce:animate-none",
        className,
      )}
      data-step-glyph={state}
    />
  );
}
