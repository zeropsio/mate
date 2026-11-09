/**
 * The one section label on every page and panel: sentence case, 13 px (`text-body`), medium, muted; a count
 * after " · "; one action at the line's end. It hugs the rows under it — the parent's gap between
 * groups is at least twice the label's gap to its rows.
 */
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";

/**
 * Props: `children` (the label, sentence case: "Waiting on you", "Places"); `count` (said after
 * " · ", or any short fact: "v0.1.3, released 7d ago"); `action` (one `SectionAction` at the end);
 * `level` (its heading level: 2 on a page, 3 in a panel or under a page's section; default 2);
 * `id` (to name the section with `aria-labelledby`).
 */
export function SectionLabel({
  children,
  count,
  action,
  level = 2,
  id,
}: {
  readonly children: ReactNode;
  readonly count?: ReactNode;
  readonly action?: ReactNode;
  readonly level?: 2 | 3;
  readonly id?: string;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-1.5" data-zerops-section-label="">
      <Heading className="m-0 min-w-0 truncate text-body font-medium text-muted-foreground" id={id}>
        {children}
        {count === undefined || count === null ? null : (
          <span className="font-normal text-muted-foreground/75 tabular-nums">
            {" · "}
            {count}
          </span>
        )}
      </Heading>
      {action === undefined || action === null ? null : (
        <span className="ms-auto flex shrink-0 items-center">{action}</span>
      )}
    </div>
  );
}

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
