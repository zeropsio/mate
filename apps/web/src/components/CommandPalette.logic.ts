import {
  type EnvironmentId,
  type FilesystemBrowseEntry,
  type KeybindingCommand,
  type ProviderInstanceId,
  type ThreadId,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { filterFilesystemBrowseEntries } from "@t3tools/client-runtime/state/filesystem";
import {
  hasMate,
  nameUnderApp,
  projectNameInApp,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqMates, HqStructure } from "@t3tools/client-runtime/zerops/hq";
import type { ThreadDigest } from "@t3tools/shared/mateLink";
import { toneIdForKind, viewerThreadKind, type ThreadStatus } from "@t3tools/shared/threadStatus";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import { type ReactNode } from "react";
import { getThreadSortTimestamp, sortThreads } from "../lib/threadSort";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { type Project, type SidebarThreadSummary, type Thread } from "../types";

export const RECENT_THREAD_LIMIT = 12;
export const ITEM_ICON_CLASS = "size-4 text-icon-muted";
export const ADDON_ICON_CLASS = "size-4";

export function browseInputEndPaddingClass(input: {
  readonly willCreateProjectPath: boolean;
  readonly hasHighlightedBrowseItem: boolean;
}): string {
  if (input.willCreateProjectPath) {
    return "*:data-[slot=autocomplete-input]:pe-38!";
  }
  if (input.hasHighlightedBrowseItem) {
    return "*:data-[slot=autocomplete-input]:pe-30!";
  }
  return "*:data-[slot=autocomplete-input]:pe-24!";
}

/**
 * The global search overlay hosts three mutually exclusive surfaces: the
 * command palette (⌘K), the project file picker (⌘P), and project content
 * search (⇧⌘F). One reducer owns open/mode state so the surfaces can never
 * stack and re-triggering a mode's shortcut toggles it closed.
 */
export type SearchOverlayMode = "command" | "files" | "content";

export interface CommandPaletteOpenIntent {
  readonly kind: "add-project" | "new-thread-in" | "change-theme";
  /** "add-project" only: restricts the flow to one environment, skipping the picker. */
  readonly environmentId?: EnvironmentId;
}

export interface CommandPaletteUiState {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
}

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "ToggleMode"; readonly mode: SearchOverlayMode }
  | { readonly _tag: "OpenAddProject"; readonly environmentId?: EnvironmentId }
  | { readonly _tag: "OpenNewThreadIn" }
  | { readonly _tag: "OpenChangeTheme" }
  | { readonly _tag: "ClearOpenIntent" };

export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return action.open
        ? { open: true, mode: "command", openIntent: state.openIntent }
        : { ...state, open: false, openIntent: null };
    case "ToggleMode":
      return state.open && state.mode === action.mode
        ? { ...state, open: false, openIntent: null }
        : { open: true, mode: action.mode, openIntent: null };
    case "OpenAddProject":
      return {
        open: true,
        mode: "command",
        openIntent: {
          kind: "add-project",
          ...(action.environmentId !== undefined ? { environmentId: action.environmentId } : {}),
        },
      };
    case "OpenNewThreadIn":
      return { open: true, mode: "command", openIntent: { kind: "new-thread-in" } };
    case "OpenChangeTheme":
      return { open: true, mode: "command", openIntent: { kind: "change-theme" } };
    case "ClearOpenIntent":
      return state.openIntent ? { ...state, openIntent: null } : state;
  }
}

export interface CommandPaletteThreadContentMatch {
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly query: string;
}

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  readonly timestamp?: string;
  readonly searchRecency?: number;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  /** Optional content rendered inline before the title text. */
  readonly titleLeadingContent?: ReactNode;
  /** Optional content rendered inline after the title text (before the timestamp). */
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

export interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
): CommandPaletteActionItem[] {
  return items.map((item, index) => {
    const shortcutCommand = THREAD_JUMP_KEYBINDING_COMMANDS[index];
    if (shortcutCommand) return { ...item, shortcutCommand };

    const { shortcutCommand: _shortcutCommand, ...itemWithoutShortcut } = item;
    return itemWithoutShortcut;
  });
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
// A project as the palette shows it. `displayName` is the grouped label (for
// example "owner/repo" when projects are merged across machines). Keep `title`
// as the real project title: the automatic project icon is derived from it, and
// every other surface uses the real title, so overriding it desyncs the icon.
export type CommandPaletteProject = Project & { readonly displayName: string };

export function buildProjectActionItems(input: {
  projects: ReadonlyArray<CommandPaletteProject>;
  valuePrefix: string;
  icon: (project: CommandPaletteProject) => ReactNode;
  runProject: (project: CommandPaletteProject) => Promise<void>;
  searchTerms?: (project: CommandPaletteProject) => ReadonlyArray<string>;
  renderDescription?: (project: CommandPaletteProject) => ReactNode;
  shortcutCommand?: KeybindingCommand;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: "action",
    value: `${input.valuePrefix}:${project.environmentId}:${project.id}`,
    searchTerms: [
      project.displayName,
      project.title,
      project.workspaceRoot,
      ...(input.searchTerms?.(project) ?? []),
    ],
    title: project.displayName,
    description: input.renderDescription?.(project) ?? project.workspaceRoot,
    icon: input.icon(project),
    ...(input.shortcutCommand !== undefined ? { shortcutCommand: input.shortcutCommand } : {}),
    run: async () => {
      await input.runProject(project);
    },
  }));
}

export type BuildThreadActionItemsThread = Pick<
  SidebarThreadSummary,
  | "archivedAt"
  | "branch"
  | "createdAt"
  | "crew"
  | "environmentId"
  | "id"
  | "modelSelection"
  | "projectId"
  | "session"
  | "title"
  | "worktreePath"
> & {
  updatedAt: string;
  latestUserMessageAt?: string | null;
};

/**
 * The chats HQ lists of the Mates this browser holds no socket to (open question 4): their titles
 * and status, never a branch, a change or a terminal, which only a Mate's own socket reads.
 */
export interface CommandPaletteHqThreads {
  /** HQ's Mates, by project; null while nothing is known. */
  readonly mates: HqMates | null;
  /** `mates` is HQ's answer now; a status kept from before is not drawn as if it were. */
  readonly current: boolean;
  /** This browser holds a socket to the environment: its chats come from its own threads. */
  readonly connected: (environmentId: EnvironmentId) => boolean;
  /** A link into the environment would open: the route gate's verdict. */
  readonly linkable: (environmentId: EnvironmentId) => boolean;
  /** This device's last visit to a chat, which finishes its digest's kind. */
  readonly lastVisitedAt: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
  ) => string | null | undefined;
  /** The Mate's name, by its project. */
  readonly mateName: (projectId: string) => string | undefined;
  /** The application a Mate is in: its chats are found by it too. */
  readonly mateApp?: (projectId: string) => string | undefined;
  readonly renderStatus: (status: ThreadStatus) => ReactNode;
}

/** The Mates HQ's structure relays, each with the name of the application it is in. */
function relayedMates(structure: HqStructure | null) {
  return [
    ...(structure?.ungrouped ?? []).map((entry) => ({ ...entry, app: undefined })),
    ...(structure?.apps ?? []).flatMap((app) =>
      app.projects
        .filter(({ mate }) => mate !== null)
        .map((entry) => ({ ...entry, app: app.name })),
    ),
  ];
}

/**
 * Each Mate's name by its project, for the chats HQ lists: its project's name in Zerops under its
 * application (`nameUnderApp`), as this client's listing reads it, else as HQ's structure relays it
 * — which may arrive first.
 */
export function hqChatMateNames(
  listed: ReadonlyArray<ZeropsCandidate>,
  structure: HqStructure | null,
): ReadonlyMap<string, string> {
  return new Map([
    ...relayedMates(structure).flatMap(({ projectId, name, app }) =>
      name === "" ? [] : [[projectId, nameUnderApp(name, app)] as const],
    ),
    ...listed
      .filter(hasMate)
      .map((row) => [row.project.id, projectNameInApp(row.project)] as const),
  ]);
}

/**
 * Each Mate's application by its project, as `hqChatMateNames` reads it: a Mate's chats are found
 * by the application's name too, its own name being what follows it.
 */
export function hqChatMateApps(
  listed: ReadonlyArray<ZeropsCandidate>,
  structure: HqStructure | null,
): ReadonlyMap<string, string> {
  return new Map([
    ...relayedMates(structure).flatMap(({ projectId, app }) =>
      app === undefined || app === "" ? [] : [[projectId, app] as const],
    ),
    ...listed.filter(hasMate).flatMap((row) => {
      const app = readZeropsMembership(row.project).label;
      return app === undefined ? [] : [[row.project.id, app] as const];
    }),
  ]);
}

interface HqChat {
  readonly environmentId: EnvironmentId;
  readonly digest: ThreadDigest;
  readonly mateName: string | undefined;
  readonly mateApp: string | undefined;
  readonly status: ReactNode;
}

/**
 * The environments whose chats HQ lists in place of their own threads — each Mate with no socket
 * HQ holds a list for, whose threads kept from before are no longer current — and those chats, in
 * each Mate's own order, of the environments a link would open.
 */
function hqChats(hq: CommandPaletteHqThreads | undefined): {
  readonly listed: ReadonlySet<EnvironmentId>;
  readonly chats: ReadonlyArray<HqChat>;
} {
  const listed = new Set<EnvironmentId>();
  const chats: HqChat[] = [];
  for (const [projectId, mate] of hq?.mates ?? []) {
    const environmentId = mate.identity?.environmentId;
    if (hq === undefined || environmentId === undefined || mate.threads === undefined) continue;
    if (hq.connected(environmentId)) continue;
    listed.add(environmentId);
    if (!hq.linkable(environmentId)) continue;
    const mateName = hq.mateName(projectId);
    const mateApp = hq.mateApp?.(projectId);
    for (const digest of mate.threads.list) {
      const kind = viewerThreadKind(digest, hq.lastVisitedAt(environmentId, digest.id));
      chats.push({
        environmentId,
        digest,
        mateName,
        mateApp,
        status: hq.current ? hq.renderStatus({ kind, toneId: toneIdForKind(kind) }) : null,
      });
    }
  }
  return { listed, chats };
}

/** A digest's recency: its turn's completion, or now for a turn still under way. */
function digestRecency(digest: ThreadDigest): number {
  if (digest.completedAt !== null) return Date.parse(digest.completedAt);
  return digest.kind === "idle" ? 0 : Number.MAX_SAFE_INTEGER;
}

function hqChatActionItem(
  { environmentId, digest, mateName, mateApp, status }: HqChat,
  icon: ReactNode,
  runThread: (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) => Promise<void>,
): CommandPaletteActionItem {
  return Object.assign(
    {
      kind: "action" as const,
      value: `thread:${digest.id}`,
      searchTerms: [digest.title, mateName ?? ``, mateApp ?? ``, digest.id],
      title: digest.title,
      searchRecency: digestRecency(digest),
      icon,
    },
    mateName === undefined ? {} : { description: mateName },
    digest.completedAt === null ? {} : { timestamp: formatRelativeTimeLabel(digest.completedAt) },
    status ? { titleLeadingContent: status } : {},
    {
      run: async () => {
        await runThread({ environmentId, id: digest.id });
      },
    },
  );
}

export function buildThreadActionItems<TThread extends BuildThreadActionItemsThread>(input: {
  threads: ReadonlyArray<TThread>;
  /** The chats HQ lists of the Mates with no socket, after the threads at hand. */
  hq?: CommandPaletteHqThreads;
  activeThreadId?: Thread["id"];
  projectTitleById: ReadonlyMap<Project["id"], string>;
  sortOrder: SidebarThreadSortOrder;
  icon: ReactNode;
  /** Optional content rendered inline before the title text per-thread. */
  renderLeadingContent?: (thread: TThread) => ReactNode;
  /** Optional content rendered inline after the title text per-thread. */
  renderTrailingContent?: (thread: TThread) => ReactNode;
  /** Optional rich description (e.g. favicon + workspace icons). Falls back to text. */
  renderDescription?: (thread: TThread, meta: { projectTitle: string | undefined }) => ReactNode;
  getContentMatch?: (thread: TThread) => CommandPaletteThreadContentMatch | undefined;
  runThread: (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) => Promise<void>;
  limit?: number;
}): CommandPaletteActionItem[] {
  const fromHq = hqChats(input.hq);
  // A crewmate's thread is the crew's, opened from the crew, never listed.
  const sortedThreads = sortThreads(
    input.threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.crew === undefined &&
        !fromHq.listed.has(thread.environmentId),
    ),
    input.sortOrder,
  );

  const threadItems = sortedThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    if (thread.id === input.activeThreadId) {
      descriptionParts.push("Current thread");
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);
    const contentMatch = input.getContentMatch?.(thread);
    const description = input.renderDescription
      ? input.renderDescription(thread, { projectTitle })
      : descriptionParts.join(` · `);

    return Object.assign(
      {
        kind: "action" as const,
        value: `thread:${thread.id}`,
        searchTerms: [
          thread.title,
          projectTitle ?? ``,
          thread.branch ?? ``,
          contentMatch?.snippet ?? ``,
          // Last so pasted IDs never outrank title matches for shared substrings.
          thread.id,
        ],
        title: thread.title,
        description,
        timestamp: formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        ),
        searchRecency: getThreadSortTimestamp(thread, "updated_at"),
        icon: input.icon,
      },
      leadingContent ? { titleLeadingContent: leadingContent } : {},
      trailingContent ? { titleTrailingContent: trailingContent } : {},
      contentMatch ? { threadContentMatch: contentMatch } : {},
      {
        run: async () => {
          await input.runThread(thread);
        },
      },
    );
  });
  const items = [
    ...threadItems,
    ...fromHq.chats.map((chat) => hqChatActionItem(chat, input.icon, input.runThread)),
  ];
  return input.limit === undefined ? items : items.slice(0, input.limit);
}

function rankSearchFieldMatch(field: string, normalizedQuery: string): number {
  const normalizedField = normalizeSearchText(field);
  if (normalizedField.length === 0 || !normalizedField.includes(normalizedQuery)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (normalizedField === normalizedQuery) {
    return 3;
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return 2;
  }
  return 1;
}

function rankCommandPaletteItemMatch(
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  normalizedQuery: string,
): number {
  const terms = item.searchTerms.filter((term) => term.length > 0);
  if (terms.length === 0) {
    return 0;
  }

  for (const [index, field] of terms.entries()) {
    const fieldRank = rankSearchFieldMatch(field, normalizedQuery);
    if (fieldRank !== Number.NEGATIVE_INFINITY) {
      if (index === 0 && item.searchRecency !== undefined) {
        // All non-exact thread title matches share a tier so recency breaks the tie.
        return 1_000 + Number(fieldRank === 3);
      }
      return 1_000 - index * 100 + fieldRank;
    }
  }

  return 0;
}

export function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  query: string;
  isInSubmenu: boolean;
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const isActionsFilter = input.query.startsWith(">");
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === "actions");
    }
    return [...input.activeGroups];
  }

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === "actions");
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== "recent-threads");
  }

  const searchableGroups = [...baseGroups];
  if (!input.isInSubmenu && !isActionsFilter) {
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
  }

  return searchableGroups.flatMap((group) => {
    const items = Arr.filterMap(group.items, (item, index) => {
      const haystack = normalizeSearchText(item.searchTerms.join(" "));
      if (!haystack.includes(normalizedQuery)) {
        return Result.failVoid;
      }

      return Result.succeed({
        item,
        index,
        rank: rankCommandPaletteItemMatch(item, normalizedQuery),
      });
    })
      .toSorted(
        (left, right) =>
          right.rank - left.rank ||
          (right.item.searchRecency ?? 0) - (left.item.searchRecency ?? 0) ||
          left.index - right.index,
      )
      .map((entry) => entry.item);

    if (items.length === 0) {
      return [];
    }

    return [{ value: group.value, label: group.label, items }];
  });
}

export function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void | Promise<void>;
  browseTo: (name: string) => void | Promise<void>;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        await input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        await input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export function filterPinnedBrowseEntries(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  filterQuery: string;
  pinnedDirectoryName: string;
  caseSensitive: boolean;
}): ReturnType<typeof filterFilesystemBrowseEntries> {
  const namesMatch = (left: string, right: string) =>
    input.caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
  const visibleFilterQuery = namesMatch(input.filterQuery, input.pinnedDirectoryName)
    ? ""
    : input.filterQuery;
  const { visibleEntries } = filterFilesystemBrowseEntries(input.browseEntries, visibleFilterQuery);
  const exactEntry =
    input.filterQuery.length > 0
      ? (input.browseEntries.find((entry) => namesMatch(entry.name, input.filterQuery)) ?? null)
      : null;
  return { visibleEntries, exactEntry };
}

export function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  if (input.actionItems.length > 0) {
    groups.push({ value: "actions", label: "Actions", items: input.actionItems });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent Threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}

export interface CommandPaletteListsRead {
  readonly organizationId: string | null;
  readonly read: boolean;
}

/** A negative answer is earned once per organization, and survives its reconnects. */
export function paletteListsRead(
  previous: CommandPaletteListsRead | null,
  input: {
    readonly organizationId: string | null;
    readonly bootstrapped: boolean;
    readonly hqMatesRead: boolean;
  },
): CommandPaletteListsRead {
  const read =
    (previous?.organizationId === input.organizationId && previous.read) ||
    (input.bootstrapped && input.hqMatesRead);
  if (previous?.organizationId === input.organizationId && previous.read === read) return previous;
  return { organizationId: input.organizationId, read };
}

/**
 * What the palette says when nothing matches: its actions are its own and known at once, but
 * "no matching projects or threads" is an answer — nothing is said while they are not read.
 */
export function paletteNoMatchMessage(input: {
  readonly isActionsOnly: boolean;
  /** Socket shells and the active organization's HQ list have settled. */
  readonly listsRead: boolean;
}): string {
  if (input.isActionsOnly) return "No matching actions.";
  return input.listsRead ? "No matching commands, projects, or threads." : "";
}

/** Why "Restart the coding agent" waits: stopping would end the run. */
export const RESTART_CODING_AGENT_WHILE_WORKING = "It is working. Stop the run first.";

/**
 * What "Restart the coding agent" does to a Mate's chat. Stopping the process
 * keeps the conversation: the next message starts a fresh one that resumes it
 * with new skills, plugins and MCP servers loaded. The fresh rescan updates
 * the composer's slash menu at once. While a turn runs or starts, stopping
 * would end it and cancel the messages still starting, so it is unavailable.
 * `workspaceRoot` is the project's folder.
 */
export function restartCodingAgentPlan(
  thread: Pick<Thread, "session" | "modelSelection" | "worktreePath">,
  workspaceRoot: string | undefined,
):
  | {
      readonly available: true;
      readonly stop: boolean;
      readonly rescan: {
        readonly instanceId: ProviderInstanceId;
        readonly cwd: string;
        readonly fresh: true;
      } | null;
    }
  | { readonly available: false; readonly reason: string } {
  const status = thread.session?.status;
  if (status === "running" || status === "starting") {
    return { available: false, reason: RESTART_CODING_AGENT_WHILE_WORKING };
  }
  const cwd = thread.worktreePath ?? workspaceRoot;
  return {
    available: true,
    stop: thread.session !== null && status !== "stopped",
    rescan:
      cwd === undefined
        ? null
        : {
            instanceId: thread.session?.providerInstanceId ?? thread.modelSelection.instanceId,
            cwd,
            fresh: true,
          },
  };
}
