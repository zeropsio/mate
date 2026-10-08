import type { ContextMenuItem, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  Bot,
  Cloud,
  Database,
  FileDiff,
  Files,
  GitBranch,
  GitPullRequestArrow,
  Globe,
  type LucideIcon,
  Plus,
  TerminalSquare,
  Plug,
  Users,
  Vault,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import { resolveShortcutCommand, type ShortcutMatchContext } from "~/keybindings";
import {
  launcherActions,
  type RightPanelAvailability,
  type RightPanelKind,
} from "~/rightPanelKinds";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { useTheme } from "~/hooks/useTheme";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./RightPanelShell";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  /** Forwarded to PreviewPanelShell so this surface persists its own width. */
  widthStorageKey?: string;
  /** Forwarded to PreviewPanelShell as the initial width before a user resize. */
  defaultWidth?: number;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  availability: Record<RightPanelKind, RightPanelAvailability>;
  onAdd: (kind: Exclude<RightPanelKind, "file" | "terminal">) => void;
  onAddTerminal: () => void;
  /** Running + waiting subagents; badges the Agents card in the empty state. */
  liveAgentCount: number;
  /** Resolve the new-tab shortcut (Mod+T) against the person's bindings;
      without them the panel has no new-tab shortcut. */
  keybindings?: ResolvedKeybindingsConfig;
  getShortcutContext?: () => ShortcutMatchContext;
  children: ReactNode;
}

const SURFACE_DISABLED_REASONS = {
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
  agents: "Agents are only available from a thread.",
  zerops: "The Zerops project map is only available from a thread.",
  browser: "The Browser view is only available from a Zerops project thread.",
  data: "Data is only available from a Zerops project thread.",
  git: "Git is only available from a Zerops project thread.",
  crew: "The crew is only available from a Zerops project thread with crew mode on.",
  mcp: "MCP servers are only available from a conversation.",
  vault: "The vault is only available from a Zerops project thread.",
} as const satisfies Record<Exclude<RightPanelKind, "file">, string>;

/** Overlays that must win over the launcher's letter shortcuts. */
const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  '[data-slot="dialog-popup"]',
  '[data-slot="alert-dialog-popup"]',
  '[data-slot="command-dialog-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

type TabContextMenuAction = "copy-path" | "close" | "close-others" | "close-to-right" | "close-all";

type SurfaceShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey"
>;

export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return (
    actions.find(
      (action) => action.available && action.shortcut.toLowerCase() === event.key.toLowerCase(),
    ) ?? null
  );
}

/**
 * A focused editable is a typing context whether or not it has text yet: an
 * empty chat composer at rest is still where the user's next keystrokes are
 * meant to land, and claiming launcher letters from it would redirect prompts
 * into whatever surface opens. The `:not` clause lets `closest` see past
 * non-editable islands (`contenteditable="false"`) to an editable host around
 * them, matching ComposerPendingUserInputPanel's typing guard.
 */
export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
      aria-keyshortcuts={props.shortcut}
    >
      {props.children}
      <MenuShortcut>{props.shortcut}</MenuShortcut>
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

type SurfaceAction = ReturnType<typeof launcherActions>[number] & {
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly badgeCount: number;
};

function surfaceLauncherIcon(kind: Exclude<RightPanelKind, "file">): LucideIcon {
  switch (kind) {
    case "terminal":
      return TerminalSquare;
    case "files":
      return Files;
    case "diff":
      return FileDiff;
    case "agents":
      return Bot;
    case "zerops":
      return Cloud;
    case "browser":
      return Globe;
    case "data":
      return Database;
    case "git":
      return GitBranch;
    case "crew":
      return Users;
    case "mcp":
      return Plug;
    case "vault":
      return Vault;
  }
}

/**
 * Renders the empty panel as a keyboard-first card launcher. A surface's
 * letter opens it outside typing contexts, while unavailable surfaces remain
 * visible with a one-line reason.
 */
function RightPanelEmptyState(props: { actions: readonly SurfaceAction[] }) {
  // -1 means no highlight: it only appears on hover or arrow use.
  const [highlight, setHighlight] = useState(-1);
  // Only an arrow key scrolls the lit card into view: a hovered one is
  // already where the pointer is.
  const arrowMovedRef = useRef(false);

  const availableActions = props.actions.filter((action) => action.available);
  const highlightIndex =
    availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1);

  // Letter shortcuts work while the launcher is visible, not only while it
  // is focused; focus moves around too easily (stray clicks) to carry them.
  // Capture phase so app-level key handlers cannot swallow the event first;
  // typing contexts and already-handled events are left alone.
  const shortcutActionsRef = useRef(availableActions);
  useEffect(() => {
    shortcutActionsRef.current = availableActions;
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = surfaceShortcutActionForKey(shortcutActionsRef.current, event);
      if (!action) return;
      if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
      const target = event.target;
      if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
      event.preventDefault();
      event.stopPropagation();
      action.onClick();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (availableActions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      arrowMovedRef.current = true;
      setHighlight((highlightIndex + 1) % availableActions.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      arrowMovedRef.current = true;
      setHighlight(
        highlightIndex === -1
          ? availableActions.length - 1
          : (highlightIndex - 1 + availableActions.length) % availableActions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      // A focused card button owns its own activation; only open from the
      // highlight when the container itself has focus.
      if (event.target instanceof HTMLElement && event.target.closest("button")) return;
      const action = availableActions[highlightIndex];
      if (!action) return;
      event.preventDefault();
      action.onClick();
    }
  };

  // Stable identity so React only runs this callback ref on mount/unmount;
  // an inline arrow would re-attach and re-focus on every render.
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    launcherRef.current = node;
    node?.focus();
  }, []);

  // A one-column launcher outgrows a narrow panel and scrolls: the lit card
  // comes into view, or Enter would open a card the person can't see.
  useEffect(() => {
    if (highlightIndex === -1 || !arrowMovedRef.current) return;
    arrowMovedRef.current = false;
    launcherRef.current
      ?.querySelector("[data-surface-launcher-highlighted]")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const isHighlighted = (action: SurfaceAction) =>
    highlightIndex !== -1 && availableActions[highlightIndex] === action;

  // The card's head row: icon, name, the live count beside the name (never on
  // the icon, where it would cover both), and the key chip on the row's own
  // centre line so every card's chip sits on one rhythm.
  const cardHead = (action: SurfaceAction) => {
    const Icon = action.icon;
    return (
      <span className="flex w-full min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0" />
        <span className="truncate font-medium text-sm">{action.label}</span>
        {action.badgeCount > 0 ? (
          <span
            aria-hidden
            className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-3xs font-semibold tabular-nums text-primary-foreground"
          >
            {action.badgeCount}
          </span>
        ) : null}
        <Kbd className="ms-auto shrink-0">{action.shortcut}</Kbd>
      </span>
    );
  };

  const cardShellClass =
    "flex w-full min-w-0 flex-col items-start gap-1 rounded-lg border border-border/80 bg-card p-3 text-left @[22rem]:p-3.5 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5";
  const highlightedCardClass = "bg-accent/60 dark:inset-ring-white/20";
  const cardTextClass = "text-muted-foreground text-xs leading-relaxed";

  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Open a surface"
      data-surface-launcher-keys={availableActions.map((action) => action.shortcut).join("")}
      className={cn(
        "flex min-h-0 flex-1 overflow-y-auto px-4 pt-4 outline-none @container",
        // The panel topbar sits above this container; matching bottom padding
        // keeps the cards centered against the full panel, not the leftover.
        "pb-[calc(var(--workspace-topbar-height)+--spacing(6))]",
      )}
    >
      {/* m-auto, not justify-center: a launcher taller than the panel scrolls
          from its title instead of losing the top under the tab bar. */}
      <div className="m-auto w-full max-w-lg">
        <div className="mb-4 text-center">
          <h3 className="font-medium text-foreground text-sm">Open a surface</h3>
          <p className="mt-1 text-muted-foreground text-xs">
            Choose what to show in the right panel.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 @[24rem]:grid-cols-2">
          {props.actions.map((action) =>
            action.available ? (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                // Move, not enter: a list the arrow keys scroll slides cards under a
                // resting pointer, and an enter would take the highlight back.
                onMouseMove={() => setHighlight(availableActions.indexOf(action))}
                onMouseLeave={() =>
                  setHighlight((current) =>
                    current === availableActions.indexOf(action) ? -1 : current,
                  )
                }
                data-surface-launcher-highlighted={isHighlighted(action) ? "" : undefined}
                className={cn(
                  "cursor-pointer transition hover:border-border hover:bg-accent/60",
                  cardShellClass,
                  isHighlighted(action) && highlightedCardClass,
                )}
              >
                {cardHead(action)}
                <span className={cardTextClass}>{action.description}</span>
              </button>
            ) : (
              <div key={action.label} className={cn("opacity-40", cardShellClass)}>
                {cardHead(action)}
                <span className={cardTextClass}>{action.unavailableHint}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "agents":
      // One word for them everywhere: the card says "helpers" (run 11).
      return "Helpers";
    case "zerops":
      return "Zerops";
    case "browser":
      return "service" in surface ? surface.service : "Browser";
    case "data":
      return "service" in surface ? surface.service : "Data";
    case "git":
      return "Git";
    case "crew":
      return "Crew";
    case "mcp":
      return "MCP";
    case "vault":
      return "Vault";
    case "change":
      return `${surface.repository} #${String(surface.number)}`;
  }
}

function SurfaceIcon({ surface, theme }: { surface: RightPanelSurface; theme: "light" | "dark" }) {
  switch (surface.kind) {
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "agents":
      return <Bot className="size-3 shrink-0" />;
    case "zerops":
      return <Cloud className="size-3 shrink-0" />;
    case "browser":
      return <Globe className="size-3 shrink-0" />;
    case "data":
      return <Database className="size-3 shrink-0" />;
    case "git":
      return <GitBranch className="size-3 shrink-0" />;
    case "crew":
      return <Users className="size-3 shrink-0" />;
    case "mcp":
      return <Plug className="size-3 shrink-0" />;
    case "vault":
      return <Vault className="size-3 shrink-0" />;
    case "change":
      return <GitPullRequestArrow className="size-3 shrink-0" />;
  }
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [addSurfaceMenuOpen, setAddSurfaceMenuOpen] = useState(false);
  const addSurfaceTriggerRef = useRef<HTMLButtonElement>(null);
  const surfaceContentRef = useRef<HTMLDivElement>(null);
  const hasSurfaces = props.surfaces.length > 0;

  // Mod+T opens the add menu; with no tab open the launcher is that menu, so
  // the shortcut moves to it. Capture phase, like the launcher's letters.
  const onNewSurfaceKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || !props.keybindings) return;
    if (
      resolveShortcutCommand(event, props.keybindings, {
        context: { ...props.getShortcutContext?.(), rightPanelOpen: true },
      }) !== "rightPanel.new"
    )
      return;
    if (!addSurfaceMenuOpen && document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (!hasSurfaces) {
      surfaceContentRef.current
        ?.querySelector<HTMLElement>("[data-surface-launcher-keys]")
        ?.focus();
      return;
    }
    addSurfaceTriggerRef.current?.focus();
    setAddSurfaceMenuOpen(true);
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onNewSurfaceKeyDown(event);
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  const addSurfaceActions: SurfaceAction[] = launcherActions(props.availability).map((action) => {
    const kind = action.kind;
    return {
      ...action,
      icon: surfaceLauncherIcon(kind),
      onClick: kind === "terminal" ? props.onAddTerminal : () => props.onAdd(kind),
      badgeCount: kind === "agents" ? props.liveAgentCount : 0,
    };
  });

  const handleAddSurfaceMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = surfaceShortcutActionForKey(addSurfaceActions, event.nativeEvent);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    setAddSurfaceMenuOpen(false);
    action.onClick();
  };

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;

      const items: ContextMenuItem<TabContextMenuAction>[] = [];
      if (surface.kind === "file") {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      items.push(
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: props.surfaces.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: props.surfaces.length === 0,
        },
      );

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "copy-path":
          if (surface.kind === "file") props.onCopyFilePath(surface.relativePath);
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      props.onCloseSurface(surface);
    },
    [props],
  );

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId]);

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pl-2",
          // The sheet overlays from the viewport top, so its tab bar keeps
          // the titlebar's height: a compact row re-centers the layout
          // controls a few pixels higher and the cluster jumps on open.
          props.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
          ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]",
          props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          radius="none"
          ref={tabListRef}
          hideScrollbars
          scrollFade
          className={cn("min-w-0 flex-1", ownsDesktopTitleBar && "drag-region")}
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            {props.surfaces.map((surface) => {
              const active = surface.id === props.activeSurfaceId;
              const pending = props.pendingSurfaceIds.has(surface.id);
              const title = surfaceTitle(surface, props.terminalLabelsById);
              return (
                <div
                  key={surface.id}
                  data-active-tab={active}
                  onMouseDown={handleTabMouseDown}
                  onAuxClick={(event) => handleTabAuxClick(event, surface)}
                  onContextMenu={(event) => void handleTabContextMenu(event, surface)}
                  className={cn(
                    "cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <PanelTabCloseButton
                    label={`Close ${title}`}
                    onClick={() => props.onCloseSurface(surface)}
                  >
                    <SurfaceIcon surface={surface} theme={resolvedTheme} />
                    {pending ? (
                      <span
                        className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
                        aria-hidden
                      />
                    ) : null}
                  </PanelTabCloseButton>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="cursor-pointer flex min-w-0 items-center"
                          onClick={() => props.onActivate(surface)}
                        >
                          <span className="truncate">{title}</span>
                        </button>
                      }
                    />
                    <TooltipPopup>{title}</TooltipPopup>
                  </Tooltip>
                </div>
              );
            })}
            {hasSurfaces ? (
              <Menu open={addSurfaceMenuOpen} onOpenChange={setAddSurfaceMenuOpen}>
                <MenuTrigger
                  render={
                    <Button
                      ref={addSurfaceTriggerRef}
                      aria-label="Add panel surface"
                      className="shrink-0"
                      size="icon-xs"
                      variant="ghost-muted"
                    />
                  }
                >
                  <Plus className="size-3.5" />
                </MenuTrigger>
                <MenuPopup
                  align="start"
                  side="bottom"
                  sideOffset={6}
                  onKeyDownCapture={handleAddSurfaceMenuKeyDown}
                >
                  {addSurfaceActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <SurfaceMenuItem
                        key={action.label}
                        available={action.available}
                        disabledReason={SURFACE_DISABLED_REASONS[action.kind]}
                        shortcut={action.shortcut}
                        onClick={action.onClick}
                      >
                        <Icon />
                        {action.label}
                      </SurfaceMenuItem>
                    );
                  })}
                </MenuPopup>
              </Menu>
            ) : null}
          </div>
        </ScrollArea>
        {props.layoutControls}
      </div>
      <div
        ref={surfaceContentRef}
        className="flex min-h-0 flex-1 flex-col"
        data-right-panel-surface-content
      >
        {props.activeSurfaceId === null ? (
          <RightPanelEmptyState actions={addSurfaceActions} />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}
