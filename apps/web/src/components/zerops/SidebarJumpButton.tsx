/**
 * Search, in the menu's top row: a field of the menu's own that says "Search" and its key
 * (⌘K), filling the row between the mark and New — not a round icon copied from another app
 * (the owner, 2026-10-11).
 *
 * It opens the jump box, which finds a Mate, a project, a change, a stop or
 * words in a conversation, writes to a Mate after `@`, and starts a new
 * project (`JumpBox.tsx`); `/` opens it too.
 */
import { SearchIcon } from "lucide-react";

export function SidebarJumpButton({
  shortcut,
  onJump,
}: {
  /** The palette's key as this platform writes it (`⌘K`); nothing where it has none. */
  readonly shortcut: string | undefined;
  readonly onJump: () => void;
}) {
  return (
    <button
      aria-keyshortcuts={shortcut === undefined ? "/" : `${ariaShortcut(shortcut)} /`}
      aria-label="Search"
      className="menu-search"
      data-zerops-surface="sidebar-jump"
      onClick={onJump}
      type="button"
    >
      <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">Search</span>
      {shortcut === undefined ? null : (
        <kbd className="menu-search-key" data-zerops-surface="sidebar-jump-key">
          {shortcut}
        </kbd>
      )}
    </button>
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
