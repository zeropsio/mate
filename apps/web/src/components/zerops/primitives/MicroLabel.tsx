import type * as React from "react";

import { cn } from "~/lib/utils";

type MicroLabelProps = Omit<React.ComponentProps<"span">, "children"> & {
  readonly children: string;
};

function MicroLabel({ className, ...props }: MicroLabelProps) {
  return (
    <span
      {...props}
      className={cn(
        "text-[length:var(--zerops-micro-label-font-size)] [font-weight:var(--zerops-micro-label-font-weight)] tracking-[var(--zerops-micro-label-tracking)] opacity-[var(--zerops-micro-label-opacity)] uppercase",
        className,
      )}
      data-zerops-primitive="micro-label"
    />
  );
}

export { MicroLabel };
export type { MicroLabelProps };
