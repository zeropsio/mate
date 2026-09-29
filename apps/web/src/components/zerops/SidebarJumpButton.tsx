/**
 * The way into the jump box, in the logo row: one small control with its key
 * inside it — the search glyph and `⌘K` (M12).
 *
 * It used to be a row of its own over the projects, *Jump to…* with the key
 * as a chip and *New project* beside it, so ⌘K read as that button's
 * shortcut. Now nothing sits beside it that the key could belong to, and the
 * row of height it took is the list's. The box finds a Mate, a project, a
 * change, a stop or words in a conversation, writes to a Mate after `@`, and
 * starts a new project (`JumpBox.tsx`); `/` opens it too.
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
      aria-label="Jump to a Mate, project, change or stop"
      className="zerops-jump-button inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md ps-1.75 pe-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-zerops-surface="sidebar-jump"
      onClick={onJump}
      type="button"
    >
      <SearchIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {shortcut === undefined ? null : (
        <span className="zerops-jump-key font-mono text-xs font-medium">{shortcut}</span>
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
