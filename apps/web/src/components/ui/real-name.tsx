import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/**
 * A real thing's own name wherever it is printed in a line of words — a service's hostname, a
 * repository's slug, a version: the mono face, its x-height matched to the label face beside it
 * (Roboto's x-height is 0.966 of the mono face's at one size), so it never looks the larger. In
 * the ink of the words it stands in: it sets no colour, and no size of its own.
 */
function RealName({ className, ...props }: ComponentProps<"span">) {
  return (
    <span {...props} className={cn("font-mono text-[0.966em]", className)} data-slot="real-name" />
  );
}

export { RealName };
