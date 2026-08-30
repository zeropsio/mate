import type * as React from "react";

import { cn } from "~/lib/utils";

type PillTone = "primary" | "secondary";

const TONE_CLASS: Record<PillTone, string> = {
  primary:
    "border-primary bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring",
  secondary:
    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90 focus-visible:ring-ring",
};

type PillProps = Omit<React.ComponentProps<"button">, "children"> & {
  readonly label: string;
  readonly tone?: PillTone;
};

function Pill({ className, label, tone = "primary", type = "button", ...props }: PillProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-[var(--zerops-pill-radius)] border px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64",
        TONE_CLASS[tone],
        className,
      )}
      data-zerops-pill-tone={tone}
      data-zerops-primitive="pill"
      type={type}
    >
      {label}
    </button>
  );
}

export { Pill };
export type { PillProps, PillTone };
