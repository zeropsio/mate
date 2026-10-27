/**
 * A coming Mate's ⋯ in the left menu, where its creation stopped before Zerops took it as far as
 * this tab knows (`creationEnds`): *Dismiss* takes its row out — and, for an Add refused for
 * certain, *Start over* opens Add again over its project, its name there to change. A row with
 * nothing to end stands as it is.
 */
import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { dismissCreation, startAddOver, useCreation } from "~/zerops/creations";
import { creationEnds, type NewProjectBirth } from "~/zerops/newProjectBirth";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

const ROW_ACTION_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";

/** What a stopped creation's ⋯ offers, in order: none for one with nothing to end. */
export function comingEndsEntries(birth: NewProjectBirth): ReadonlyArray<{
  readonly id: "start-over" | "dismiss";
  readonly label: string;
  readonly onSelect: () => void;
}> {
  const ends = creationEnds(birth);
  if (ends === null) return [];
  return [
    ...(ends.startOver === null
      ? []
      : [
          {
            id: "start-over" as const,
            label: "Start over",
            onSelect: () => startAddOver(birth),
          },
        ]),
    { id: "dismiss", label: "Dismiss", onSelect: () => dismissCreation(birth.birthId) },
  ];
}

export function SidebarComingEnds({
  birthId,
  name,
  children,
}: {
  /** The creation's id: its row's. */
  readonly birthId: string;
  readonly name: string;
  /** The row itself. */
  readonly children: ReactNode;
}) {
  const made = useCreation(birthId);
  const entries = made === undefined ? [] : comingEndsEntries(made);
  if (entries.length === 0) return children;
  return (
    // The row is the container, the menu's trigger beside its button, as a Mate's own row.
    <div className="relative">
      {children}
      <span
        className="absolute end-2 top-2.5 flex h-5 items-center opacity-0 transition-opacity group-hover/mate:opacity-100 group-has-[:focus-visible]/mate:opacity-100 has-[[data-popup-open]]:opacity-100"
        data-zerops-surface="sidebar-mate-actions"
      >
        <Menu>
          <MenuTrigger
            render={
              <button aria-label={`More for ${name}`} className={ROW_ACTION_CLASS} type="button" />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="start" className="w-56" side="right">
            {entries.map((entry) => (
              <MenuItem key={entry.id} onClick={entry.onSelect}>
                {entry.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </span>
    </div>
  );
}
