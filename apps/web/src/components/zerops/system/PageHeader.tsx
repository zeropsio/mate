/**
 * A project's or a place's page head, one piece on both: the trail above, then the title with its
 * summary beside it on the same line (a `PlaceLine` in `header` density, or the project's address),
 * and the page's actions at the line's end. Its height does not change as the title is read.
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { Crumbs, type Crumb } from "./Crumbs";
import { InPhoneBar } from "./PhoneBar";

/**
 * Props: `trail` (from `usePageTrail`; none drawn where empty or absent); `title` (`undefined`
 * while unread: its line is held, empty); `placeholder` (the title stands in for a name not read —
 * "Couldn't read this project's name" — set quiet and italic); `tag` (a pill trailing the title, e.g. a custom stage's
 * tier); `summary` (beside the title, wrapping under it where narrow); `actions` (the page's verbs:
 * secondary `Button`s and a `···` menu).
 */
export function PageHeader({
  trail,
  title,
  placeholder = false,
  tag,
  summary,
  actions,
}: {
  readonly trail?: ReadonlyArray<Crumb> | undefined;
  readonly title: string | undefined;
  readonly placeholder?: boolean;
  readonly tag?: ReactNode;
  readonly summary?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-2.5" data-zerops-page-header="">
      {trail === undefined || trail.length === 0 ? null : (
        // On a phone the trail is the frame's bar, beside the menu's button.
        <InPhoneBar>
          <Crumbs trail={trail} />
        </InPhoneBar>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1
          className={cn(
            "m-0 min-w-0 text-2xl leading-8 font-semibold tracking-tight wrap-anywhere text-foreground",
            placeholder && "font-normal text-muted-foreground italic",
          )}
        >
          {title ?? <span aria-hidden="true">{" "}</span>}
        </h1>
        {tag}
        {summary === undefined || summary === null ? null : (
          <div className="min-w-0 text-body">{summary}</div>
        )}
        {actions === undefined || actions === null ? null : (
          <div className="ms-auto flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
