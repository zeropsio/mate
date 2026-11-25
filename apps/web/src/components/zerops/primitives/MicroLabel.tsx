import type * as React from "react";

import { cn } from "~/lib/utils";

type MicroLabelProps = Omit<React.ComponentProps<"span">, "children"> & {
  readonly children: string;
};

function MicroLabel({ className, ...props }: MicroLabelProps) {
  return (
    <span
      {...props}
      className={cn("text-3xs font-semibold tracking-wider opacity-45 uppercase", className)}
      data-zerops-primitive="micro-label"
    />
  );
}

export { MicroLabel };
