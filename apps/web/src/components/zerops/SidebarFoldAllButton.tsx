/**
 * Fold or open every project at once, in the menu's logo row beside search (the owner,
 * 2026-10-12: "how about fold / unfold all here?"): a quiet square that folds them all while any
 * stands open, and opens them all once every one is folded (`useMenuFolds`). Nothing while the
 * menu lists no project with Mates.
 */
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";

import { useMenuFolds } from "~/zerops/menuFolds";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarFoldAllButton() {
  const anyOpen = useMenuFolds((state) => state.anyOpen);
  const foldAll = useMenuFolds((state) => state.foldAll);
  if (anyOpen === null) return null;
  const words = anyOpen ? "Fold all projects" : "Open all projects";
  const Icon = anyOpen ? ChevronsDownUpIcon : ChevronsUpDownIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={words}
            className="menu-round-button"
            data-zerops-surface="sidebar-fold-all"
            onClick={() => {
              foldAll(anyOpen);
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
