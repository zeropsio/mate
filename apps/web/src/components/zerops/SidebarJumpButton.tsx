/**
 * Search, in the menu's top row: a round 34 px button with a hairline ring and
 * the search glyph, its key in its tooltip ("Search ⌘K").
 *
 * It opens the jump box, which finds a Mate, a project, a change, a stop or
 * words in a conversation, writes to a Mate after `@`, and starts a new
 * project (`JumpBox.tsx`); `/` opens it too.
 */
import { SearchIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarJumpButton({
  shortcut,
  onJump,
}: {
  /** The palette's key as this platform writes it (`⌘K`); nothing where it has none. */
  readonly shortcut: string | undefined;
  readonly onJump: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-keyshortcuts={shortcut === undefined ? "/" : `${ariaShortcut(shortcut)} /`}
            aria-label="Search"
            className="menu-round-button"
            data-zerops-surface="sidebar-jump"
            onClick={onJump}
            type="button"
          />
        }
      >
        <SearchIcon aria-hidden="true" className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span data-zerops-surface="sidebar-jump-tip">
          Search{shortcut === undefined ? "" : ` ${shortcut}`}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

/** `⌘K` as `aria-keyshortcuts` spells it: `Meta+K`. */
function ariaShortcut(label: string): string {
  return label
    .replace("⌘", "Meta+")
    .replace("⌃", "Control+")
    .replace("⌥", "Alt+")
    .replace("⇧", "Shift+")
    .replace(/^Ctrl\+?/u, "Control+")
    .replace(/\+{2,}/gu, "+");
}
