/**
 * The menu's first row, over its projects: the way into the jump box, and the
 * new project beside it.
 *
 * *Jump to…* says what the box does and names its key; the box finds a Mate,
 * a project, a change, a stop or words in a conversation, and writes to a
 * Mate after `@` (`JumpBox.tsx`). *New project* is the folder beside it, the
 * same verb the projects screen makes a page of — a glyph here, with its
 * name on hover, so the row that finds things leads.
 *
 * The same 32px as the row it replaced, so nothing under it moves. On a
 * phone the menu steps aside for the box, and comes back to show what is
 * found in it.
 */
import { FolderPlusIcon, SearchIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { KeyChip } from "./primitives";

export function SidebarJumpRow({
  shortcut,
  onJump,
  onNewProject,
}: {
  /** The palette's key as this platform writes it (`⌘K`); nothing where it has none. */
  readonly shortcut: string | undefined;
  readonly onJump: () => void;
  readonly onNewProject: () => void;
}) {
  return (
    <div className="flex items-center gap-1" data-zerops-surface="sidebar-jump-row">
      <button
        aria-keyshortcuts={shortcut === undefined ? "/" : `${ariaShortcut(shortcut)} /`}
        aria-label="Jump to a Mate, project, change or stop"
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        data-zerops-surface="sidebar-jump"
        onClick={onJump}
        type="button"
      >
        <SearchIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-sidebar-muted-foreground/80"
        />
        <span className="min-w-0 flex-1 truncate text-left">Jump to…</span>
        {shortcut === undefined ? null : <KeyChip>{shortcut}</KeyChip>}
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label="New project"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
              data-zerops-surface="sidebar-new-project"
              onClick={onNewProject}
              type="button"
            />
          }
        >
          <FolderPlusIcon aria-hidden="true" className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="right">New project</TooltipPopup>
      </Tooltip>
    </div>
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
