import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";

/**
 * A section label's one action: a quiet blue word ("All history", "+ Add a Mate", "Tea Shop's
 * page ›"). Props: `children`; `onClick(from)`; or `href` for a page outside (opened beside).
 */
export function SectionAction({
  children,
  onClick,
  href,
}: {
  readonly children: ReactNode;
  readonly onClick?: ((from: HTMLElement) => void) | undefined;
  readonly href?: string | undefined;
}) {
  if (href !== undefined)
    return (
      <Button render={<a href={href} rel="noreferrer" target="_blank" />} size="sm" variant="link">
        {children}
      </Button>
    );
  return (
    <Button
      onClick={(event) => {
        onClick?.(event.currentTarget);
      }}
      size="sm"
      variant="link"
    >
      {children}
    </Button>
  );
}
