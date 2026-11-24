import type * as React from "react";

import { cn } from "~/lib/utils";

function MintPanel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      {...props}
      className={cn("rounded-card bg-mint-panel", className)}
      data-zerops-primitive="mint-panel"
    />
  );
}

export { MintPanel };
