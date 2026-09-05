import type * as React from "react";

import { cn } from "~/lib/utils";

type PillTone = "primary" | "secondary" | "outline";
type PillSize = "default" | "sm";

const TONE_CLASS: Record<PillTone, string> = {
  primary:
    "border-primary bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring",
  secondary:
    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90 focus-visible:ring-ring",
  /** Navigation: present, never loud. */
  outline: "border-border bg-transparent text-foreground hover:bg-accent focus-visible:ring-ring",
};

/** `sm` is the row size: a verb beside a name, not a call to action on a page. */
const SIZE_CLASS: Record<PillSize, string> = {
  default: "min-h-9 px-4 py-2",
  sm: "min-h-8 px-3 py-1.5",
};

type PillProps = Omit<React.ComponentProps<"button">, "children"> & {
  readonly label: string;
  readonly tone?: PillTone;
  readonly size?: PillSize;
};

function Pill({
  className,
  label,
  size = "default",
  tone = "primary",
  type = "button",
  ...props
}: PillProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--zerops-pill-radius)] border text-sm font-medium outline-none transition-[background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-64 motion-reduce:transition-none",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className,
      )}
      data-zerops-pill-size={size}
      data-zerops-pill-tone={tone}
      data-zerops-primitive="pill"
      type={type}
    >
      {label}
    </button>
  );
}

export { Pill };
export type { PillProps, PillSize, PillTone };
