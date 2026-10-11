/**
 * Search, in the menu's logo row: a quiet 32 px square with the magnifier, its words and its key
 * (⌘K) in its tooltip — the row is the logo's, and a field across it was "a waste of space"
 * (the owner, 2026-10-11), as round outlined buttons were copied from another app.
 *
 * It opens the jump box, which finds a Mate, a project, a change, a stop or
 * words in a conversation, writes to a Mate after `@`, and starts a new
 * project (`JumpBox.tsx`); `/` opens it too.
 */
import {
  ArrowBigUpIcon,
  ChevronUpIcon,
  CommandIcon,
  OptionIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";

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
        Search
        {shortcut === undefined ? null : (
          <kbd
            aria-hidden="true"
            className="menu-search-key"
            data-zerops-surface="sidebar-jump-key"
          >
            <KeyLabel label={shortcut} />
          </kbd>
        )}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The Mac's modifier keys, drawn: their glyphs sit in a font file of their own (Roboto's
 * "symbols"), fetched for one character and swapped in after the menu paints. */
const MODIFIER_ICON: Readonly<Record<string, LucideIcon | undefined>> = {
  "⌘": CommandIcon,
  "⌥": OptionIcon,
  "⇧": ArrowBigUpIcon,
  "⌃": ChevronUpIcon,
};

/**
 * A key as this platform writes it: its modifiers — first, as a Mac writes them — drawn, the key
 * itself in the menu's type.
 */
function KeyLabel({ label }: { readonly label: string }) {
  const chars = [...label];
  const drawn = chars.filter((char) => MODIFIER_ICON[char] !== undefined);
  return (
    <>
      {drawn.map((char) => {
        const Icon = MODIFIER_ICON[char]!;
        return (
          <Icon
            aria-hidden="true"
            className="size-3"
            data-key={char}
            key={char}
            strokeWidth={2.25}
          />
        );
      })}
      {chars.filter((char) => MODIFIER_ICON[char] === undefined).join("")}
    </>
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
