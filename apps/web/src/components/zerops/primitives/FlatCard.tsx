import type * as React from "react";

import { cn } from "~/lib/utils";

function FlatCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-[var(--zerops-card-radius)] border border-[var(--zerops-flat-card-border)] bg-card text-card-foreground",
        className,
      )}
      data-zerops-primitive="flat-card"
    />
  );
}

export { FlatCard };
