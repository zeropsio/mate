/**
 * The one section label on every page and panel: sentence case, 14 px (`text-body`), medium, muted; a count
 * after " · "; one action at the line's end. It hugs the rows under it — the parent's gap between
 * groups is at least twice the label's gap to its rows.
 */
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { CollapsibleTrigger } from "~/components/ui/collapsible";

/**
 * Props: `children` (the label, sentence case: "Waiting on you", "Places"); `count` (said after
 * " · ", or any short fact: "v0.1.3, released 7d ago", "3 changed · +42 −3"); `action` (one
 * `SectionAction` at the end, or the section's own state there: "Reading what runs…"); `level`
 * (its heading level: 2 on a page, 3 in a panel or under a page's section; default 2); `id` (to
 * name the section with `aria-labelledby`); `folds` (the label opens and shuts the `Collapsible`
 * it stands in: its words and count are the press, a chevron at the line's end turns as it
 * opens; the action stays its own press beside it).
 */
export function SectionLabel({
  children,
  count,
  action,
  level = 2,
  id,
  folds = false,
}: {
  readonly children: ReactNode;
  readonly count?: ReactNode;
  readonly action?: ReactNode;
  readonly level?: 2 | 3;
  readonly id?: string;
  readonly folds?: boolean;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const said = (
    <>
      {children}
      {count === undefined || count === null ? null : (
        <span className="font-normal text-muted-foreground/75 tabular-nums">
          {" · "}
          {count}
        </span>
      )}
    </>
  );
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-1.5" data-zerops-section-label="">
      {folds ? (
        <Heading
          className="m-0 flex min-w-0 flex-1 text-body font-medium text-muted-foreground"
          id={id}
        >
          <CollapsibleTrigger className="group/fold flex h-7 w-full min-w-0 items-center gap-2.5 rounded-mark text-start outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0">
            <span className="min-w-0 truncate">{said}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="ms-auto size-3.5 shrink-0 transition-transform duration-200 ease-out-strong group-aria-expanded/fold:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        </Heading>
      ) : (
        <Heading
          className="m-0 min-w-0 truncate text-body font-medium text-muted-foreground"
          id={id}
        >
          {said}
        </Heading>
      )}
      {action === undefined || action === null ? null : (
        <span className="ms-auto flex shrink-0 items-center text-body">{action}</span>
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
