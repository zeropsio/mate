import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { MicroLabel } from "./MicroLabel";

const TONE_CLASS: Record<ServiceStatusToneId, string> = {
  ok: "bg-[var(--zerops-status-ok)]",
  busy: "bg-[var(--zerops-status-busy)]",
  attention: "bg-[var(--zerops-status-attention)]",
  failed: "bg-[var(--zerops-status-failed)]",
  off: "bg-[var(--zerops-status-off)]",
};

type StatusDotProps = Omit<
  React.ComponentProps<"span">,
  "aria-label" | "aria-live" | "children" | "role"
> & {
  readonly label: string;
  readonly pulse?: boolean;
  readonly tone: ServiceStatusToneId;
  /**
   * Set the phrase in the running hand — sentence case at the text's own
   * size — instead of the `MicroLabel`: for a line that is read as a
   * sentence rather than scanned as a label.
   */
  readonly sentence?: boolean;
};

function StatusDot({ className, label, pulse, sentence = false, tone, ...props }: StatusDotProps) {
  const shouldPulse = pulse ?? tone === "busy";

  return (
    <span
      {...props}
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      data-zerops-primitive="status-dot"
      data-zerops-status-tone={tone}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-2 shrink-0 rounded-full",
          TONE_CLASS[tone],
          shouldPulse && "animate-status-pulse motion-reduce:animate-none",
        )}
      />
      {sentence ? (
        <span className="min-w-0 truncate">{label}</span>
      ) : (
        <MicroLabel>{label}</MicroLabel>
      )}
    </span>
  );
}

export { StatusDot };
export type { StatusDotProps };
