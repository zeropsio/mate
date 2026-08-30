import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type * as React from "react";

import { cn } from "~/lib/utils";

const TONE_CLASS: Record<ServiceStatusToneId, string> = {
  ok: "bg-[var(--zerops-status-ok-surface)] text-[var(--zerops-status-ok-text,var(--foreground))]",
  busy: "bg-[var(--zerops-status-busy-surface)] text-[var(--zerops-status-busy-text,var(--foreground))]",
  attention:
    "bg-[var(--zerops-status-attention-surface)] text-[var(--zerops-status-attention-text,var(--foreground))]",
  failed:
    "bg-[var(--zerops-status-failed-surface)] text-[var(--zerops-status-failed-text,var(--foreground))]",
  off: "bg-[var(--zerops-status-off-surface)] text-[var(--zerops-status-off-text,var(--foreground))]",
};

type ChipProps = Omit<React.ComponentProps<"span">, "children"> & {
  readonly label: string;
  readonly tone: ServiceStatusToneId;
};

function Chip({ className, label, tone, ...props }: ChipProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center rounded-[var(--zerops-chip-radius)] px-2 py-1 text-[length:var(--zerops-micro-label-font-size)] [font-weight:var(--zerops-micro-label-font-weight)] tracking-[var(--zerops-micro-label-tracking)] uppercase",
        TONE_CLASS[tone],
        className,
      )}
      data-zerops-chip-tone={tone}
      data-zerops-primitive="chip"
    >
      {label}
    </span>
  );
}

export { Chip };
export type { ChipProps };
