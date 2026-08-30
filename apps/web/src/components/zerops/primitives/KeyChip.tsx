import type * as React from "react";

import { Kbd } from "~/components/ui/kbd";
import { cn } from "~/lib/utils";

type KeyChipProps = Omit<React.ComponentProps<typeof Kbd>, "children"> & {
  readonly children: string;
};

function KeyChip({ className, ...props }: KeyChipProps) {
  return (
    <Kbd
      {...props}
      className={cn(
        "inline-flex min-h-5 items-center rounded-[var(--zerops-key-chip-radius)] border border-border bg-muted px-1.5 font-mono text-xs text-muted-foreground",
        className,
      )}
      data-zerops-primitive="key-chip"
    />
  );
}

export { KeyChip };
export type { KeyChipProps };
