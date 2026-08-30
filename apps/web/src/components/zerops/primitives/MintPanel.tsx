import type * as React from "react";

import { cn } from "~/lib/utils";

function MintPanel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      {...props}
      className={cn("rounded-[var(--zerops-card-radius)] bg-[var(--zerops-mint-panel)]", className)}
      data-zerops-primitive="mint-panel"
    />
  );
}

export { MintPanel };
