/**
 * Whose Mates the menu lists, in the Chief Mate's bar (the owner, 2026-10-12: "the show is more
 * important than compact"): a quiet square that flips Mine and Everyone, its icon saying which
 * one the menu shows now.
 */
import { UserIcon, UsersIcon } from "lucide-react";

import type { MateScope } from "~/zerops/mateScope";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarScopeButton({
  scope,
  onScope,
}: {
  readonly scope: MateScope;
  readonly onScope: (next: MateScope) => void;
}) {
  const mine = scope === "mine";
  const words = mine
    ? "Showing your Mates · show everyone's"
    : "Showing everyone's Mates · show yours";
  const Icon = mine ? UserIcon : UsersIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={words}
            aria-pressed={mine}
            className="menu-round-button"
            data-zerops-surface="sidebar-scope"
            onClick={() => {
              onScope(mine ? "everyone" : "mine");
            }}
            type="button"
          />
        }
      >
        <Icon aria-hidden="true" className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{words}</TooltipPopup>
    </Tooltip>
  );
}
