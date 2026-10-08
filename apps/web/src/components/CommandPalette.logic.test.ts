import { describe, expect, it, vi } from "vite-plus/test";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqMates, HqStructure } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { ThreadDigest } from "@t3tools/shared/mateLink";
import type { Project, Thread } from "../types";
import {
  buildBrowseGroups,
  buildProjectActionItems,
  buildThreadActionItems,
  enumerateCommandPaletteItems,
  filterPinnedBrowseEntries,
  filterCommandPaletteGroups,
  hqChatMateApps,
  hqChatMateNames,
  reduceCommandPaletteUiState,
  restartCodingAgentPlan,
  type CommandPaletteGroup,
  paletteNoMatchMessage,
  paletteListsRead,
} from "./CommandPalette.logic";

describe("reduceCommandPaletteUiState", () => {
  const closedState = { open: false, mode: "command", openIntent: null } as const;

  it("toggles each overlay mode open and closed", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(filesOpen).toEqual({ open: true, mode: "files", openIntent: null });

    const contentOpen = reduceCommandPaletteUiState(filesOpen, {
      _tag: "ToggleMode",
      mode: "content",
    });
    expect(contentOpen).toEqual({ open: true, mode: "content", openIntent: null });

    expect(
      reduceCommandPaletteUiState(contentOpen, { _tag: "ToggleMode", mode: "content" }),
    ).toEqual({ open: false, mode: "content", openIntent: null });
  });

  it("switches between open modes without closing", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "ToggleMode", mode: "command" })).toEqual(
      {
        open: true,
        mode: "command",
        openIntent: null,
      },
    );
  });

  it("routes open intents to command mode", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenAddProject" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "add-project" },
    });
    expect(
      reduceCommandPaletteUiState(filesOpen, {
        _tag: "OpenAddProject",
        environmentId: EnvironmentId.make("environment-one"),
      }),
    ).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "add-project", environmentId: EnvironmentId.make("environment-one") },
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenNewThreadIn" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "new-thread-in" },
    });
  });

  it("preserves the mode on close and resets it on open", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });

    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: false })).toEqual({
      open: false,
      mode: "files",
      openIntent: null,
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: true })).toEqual({
      open: true,
      mode: "command",
      openIntent: null,
    });
  });
});

describe("enumerateCommandPaletteItems", () => {
  it("assigns positional jump shortcuts to the first nine displayed items", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      kind: "action" as const,
      value: `project-${index + 1}`,
      searchTerms: [],
      title: `Project ${index + 1}`,
      icon: null,
      shortcutCommand: "chat.new" as const,
      run: async () => undefined,
    }));

    expect(enumerateCommandPaletteItems(items).map((item) => item.shortcutCommand)).toEqual([
      "thread.jump.1",
      "thread.jump.2",
      "thread.jump.3",
      "thread.jump.4",
      "thread.jump.5",
      "thread.jump.6",
      "thread.jump.7",
      "thread.jump.8",
      "thread.jump.9",
      undefined,
    ]);
  });
});

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    environmentId: LOCAL_ENVIRONMENT_ID,
    title: "Project",
    workspaceRoot: "/workspace/project",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    checkpoints: [],
    activities: [],
    ...overrides,
  };
}

describe("buildProjectActionItems", () => {
  it("shows the grouped display name but keeps the real title for icons", () => {
    const project = makeProject({ title: "fleet", workspaceRoot: "/Users/theo/Code/p/fleet" });
    const iconTitles: string[] = [];
    const [item] = buildProjectActionItems({
      projects: [{ ...project, displayName: "t3dotgg/fleet" }],
      valuePrefix: "project",
      icon: (candidate) => {
        iconTitles.push(candidate.title);
        return null;
      },
      runProject: async () => undefined,
    });

    expect(item?.title).toBe("t3dotgg/fleet");
    expect(item?.searchTerms).toEqual(
      expect.arrayContaining(["t3dotgg/fleet", "fleet", "/Users/theo/Code/p/fleet"]),
    );
    expect(iconTitles).toEqual(["fleet"]);
  });
});

describe("buildThreadActionItems", () => {
  it("orders threads by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildThreadActionItems({
        threads: [
          makeThread({
            id: ThreadId.make("thread-older"),
            title: "Older thread",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.make("thread-newer"),
            title: "Newer thread",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runThread: async (_thread) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "thread:thread-older",
        "thread:thread-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks thread title matches ahead of contextual project-name matches", () => {
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("threads-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:thread-title-match",
      "thread:thread-context-match",
    ]);
  });

  it("orders title matches by recent activity before older prefix matches", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("old-prefix"),
        title: "Convex InvalidCursor in Convex threads query",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("recent-title"),
        title: "Disable Convex schema validation",
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("recent-content"),
        title: "Fix schema validation",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
      }),
    ];
    const items = buildThreadActionItems({
      threads,
      projectTitleById: new Map([[PROJECT_ID, "T3 Code"]]),
      sortOrder: "created_at",
      icon: null,
      getContentMatch: (thread) =>
        thread.id === ThreadId.make("recent-content")
          ? { source: "user", snippet: "Please check Convex", query: "convex" }
          : undefined,
      runThread: async () => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "convex",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: items,
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:recent-title",
      "thread:old-prefix",
      "thread:recent-content",
    ]);
  });

  it("preserves thread project-name matches when there is no stronger title match", () => {
    const group: CommandPaletteGroup = {
      value: "threads-search",
      label: "Threads",
      items: [
        {
          kind: "action",
          value: "thread:project-context-only",
          searchTerms: ["Fix navbar spacing", "Project"],
          title: "Fix navbar spacing",
          description: "Project",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["thread:project-context-only"]);
  });

  it("keeps message excerpts searchable without replacing thread metadata", () => {
    const [item] = buildThreadActionItems({
      threads: [makeThread({ branch: "feat/search" })],
      projectTitleById: new Map([[PROJECT_ID, "T3 Code"]]),
      sortOrder: "updated_at",
      icon: null,
      getContentMatch: () => ({
        source: "assistant",
        snippet: "The relay reconnect is now bounded.",
        query: "reconnect",
      }),
      runThread: async (_thread) => undefined,
    });

    expect(item?.searchTerms).toContain("The relay reconnect is now bounded.");
    expect(item?.threadContentMatch).toEqual({
      source: "assistant",
      snippet: "The relay reconnect is now bounded.",
      query: "reconnect",
    });
    expect(item?.description).toBe("T3 Code · #feat/search");
  });

  it("surfaces threads when the query is their ID, without outranking title matches", () => {
    const idThread = makeThread({
      id: ThreadId.make("thread-alpha-1234"),
      title: "Unrelated work",
      updatedAt: "2026-03-05T00:00:00.000Z",
    });
    const titleThread = makeThread({
      id: ThreadId.make("thread-other-9999"),
      title: "Fix thread-alpha-1234 flakes",
      updatedAt: "2026-03-04T00:00:00.000Z",
    });
    const items = buildThreadActionItems({
      threads: [idThread, titleThread],
      projectTitleById: new Map([[PROJECT_ID, "T3 Code"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "  THREAD-ALPHA-1234  ",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: items,
    });

    expect(groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ value: `thread:${titleThread.id}` }),
      expect.objectContaining({ value: `thread:${idThread.id}` }),
    ]);
  });

  it("prefers renderDescription when provided", () => {
    const [item] = buildThreadActionItems({
      threads: [makeThread({ branch: "feat/search", worktreePath: "/tmp/wt" })],
      projectTitleById: new Map([[PROJECT_ID, "T3 Code"]]),
      sortOrder: "updated_at",
      icon: null,
      renderDescription: (thread, { projectTitle }) =>
        `${projectTitle}:${thread.branch}:${thread.worktreePath ? "wt" : "local"}`,
      runThread: async (_thread) => undefined,
    });

    expect(item?.description).toBe("T3 Code:feat/search:wt");
  });

  it("filters archived threads out of thread search items", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          title: "Active thread",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          title: "Archived thread",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-active"]);
  });

  it("never offers a crewmate's thread, however recent", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-person"),
          title: "Checkout flow",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-stint"),
          title: "backend",
          updatedAt: "2026-03-20T00:00:00.000Z",
          crew: { crew: "shop", crewmate: "backend", stint: 1 },
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-person"]);
  });
});

describe("buildThreadActionItems — chats HQ lists", () => {
  const OPEN = EnvironmentId.make("environment-open");
  const PARKED = EnvironmentId.make("environment-parked");

  /** A chat as its Mate digests it. */
  const digest = (id: string, over: Partial<ThreadDigest> = {}): ThreadDigest => ({
    id: ThreadId.make(id),
    title: `Chat ${id}`,
    kind: "idle",
    turnId: null,
    turnState: "completed",
    completedAt: "2026-03-18T00:00:00.000Z",
    ...over,
  });

  /** A Mate HQ holds, its environment `environmentId`, with the chats `list`. */
  const mate = (environmentId: EnvironmentId, list: ReadonlyArray<ThreadDigest>): MateLiveView => ({
    presence: { online: true, since: "2026-03-18T00:00:00.000Z", overview: "live" },
    identity: { environmentId, serverVersion: "0.11.90", update: null },
    main: null,
    threads: { list, omitted: 0 },
    logins: {},
    crew: { status: "off" },
  });

  const hq = (mates: HqMates) => ({
    mates,
    current: true,
    connected: (environmentId: EnvironmentId) => environmentId === OPEN,
    linkable: () => true,
    lastVisitedAt: () => undefined,
    mateName: (projectId: string) => (projectId === "project-parked" ? "Ida" : undefined),
    mateApp: (projectId: string) => (projectId === "project-parked" ? "Shop" : undefined),
    renderStatus: (status: { readonly kind: string }) => `status:${status.kind}`,
  });

  it("lists an unopened Mate's chats from HQ without branch or terminal badges", async () => {
    const runThread = vi.fn(async (_thread: unknown) => undefined);
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-open"),
          environmentId: OPEN,
          title: "Open chat",
          branch: "feature/open",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      hq: hq(
        new Map([
          ["project-open", mate(OPEN, [digest("thread-open")])],
          [
            "project-parked",
            mate(PARKED, [digest("thread-parked", { title: "Checkout flow", kind: "approval" })]),
          ],
        ]),
      ),
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      renderLeadingContent: () => "shell status",
      renderTrailingContent: () => "terminal",
      runThread,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-open", "thread:thread-parked"]);
    const parked = items[1];
    expect(parked).toMatchObject({
      title: "Checkout flow",
      description: "Ida",
      titleLeadingContent: "status:approval",
    });
    expect(parked?.titleTrailingContent).toBeUndefined();
    expect(parked?.searchTerms).not.toContain("feature/open");
    expect(parked?.searchTerms).toContain("Shop");
    await parked?.run();
    expect(runThread).toHaveBeenCalledWith({ environmentId: PARKED, id: "thread-parked" });
  });

  it("takes a Mate's chats from HQ, not from what was kept of it, once it has no socket", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-parked"),
          environmentId: PARKED,
          title: "Checkout (as kept)",
          branch: "feature/checkout",
        }),
      ],
      hq: hq(
        new Map([
          [
            "project-parked",
            mate(PARKED, [digest("thread-parked", { title: "Checkout flow", kind: "working" })]),
          ],
        ]),
      ),
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      renderTrailingContent: () => "terminal",
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => [item.value, item.title, item.titleTrailingContent])).toEqual([
      ["thread:thread-parked", "Checkout flow", undefined],
    ]);
  });

  it("lists the chats of HQ's view kept from before without a status", () => {
    const [item] = buildThreadActionItems({
      threads: [],
      hq: {
        ...hq(new Map([["project-parked", mate(PARKED, [digest("t1", { kind: "approval" })])]])),
        current: false,
      },
      projectTitleById: new Map(),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(item?.value).toBe("thread:t1");
    expect(item?.titleLeadingContent).toBeUndefined();
  });
});

describe("buildBrowseGroups", () => {
  it("waits for asynchronous browse navigation actions", async () => {
    let finishNavigation: (() => void) | undefined;
    const browseTo = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
    );
    const groups = buildBrowseGroups({
      browseEntries: [{ name: "Downloads", fullPath: "/Users/test/Downloads" }],
      browseQuery: "~/",
      canBrowseUp: false,
      upIcon: null,
      directoryIcon: null,
      browseUp: vi.fn(),
      browseTo,
    });
    const item = groups[0]?.items[0];
    if (!item || item.kind !== "action") {
      throw new Error("Expected a browse action");
    }

    let actionSettled = false;
    const action = item.run().then(() => {
      actionSettled = true;
    });
    await Promise.resolve();

    expect(browseTo).toHaveBeenCalledWith("Downloads");
    expect(actionSettled).toBe(false);

    finishNavigation?.();
    await action;
    expect(actionSettled).toBe(true);
  });
});

describe("filterPinnedBrowseEntries", () => {
  const entries = [
    { name: "repo", fullPath: "/projects/repo" },
    { name: "work", fullPath: "/projects/work" },
  ];

  it("shows sibling folders without losing an existing pinned destination", () => {
    expect(
      filterPinnedBrowseEntries({
        browseEntries: entries,
        filterQuery: "repo",
        pinnedDirectoryName: "repo",
        caseSensitive: true,
      }),
    ).toEqual({ visibleEntries: entries, exactEntry: entries[0] });
  });

  it("matches an existing pinned destination without Windows casing", () => {
    const windowsEntries = [
      { name: "Repo", fullPath: "C:\\projects\\Repo" },
      { name: "work", fullPath: "C:\\projects\\work" },
    ];
    expect(
      filterPinnedBrowseEntries({
        browseEntries: windowsEntries,
        filterQuery: "repo",
        pinnedDirectoryName: "repo",
        caseSensitive: false,
      }),
    ).toEqual({
      visibleEntries: windowsEntries,
      exactEntry: windowsEntries[0],
    });
  });
});

// D3: a Mate HQ lists chats of is named as its project is in Zerops — as this client's listing reads
// it, or, until the listing has it, as HQ's structure relays it.
describe("hqChatMateNames", () => {
  const STRUCTURE: HqStructure = {
    ungrouped: [{ projectId: "p-lone", name: "Lone", mate: { face: "" } }],
    apps: [
      {
        id: "app-1",
        name: "Shop",
        projects: [
          { projectId: "p-ada", name: "Ada", kind: "mate", mate: { face: "" } },
          { projectId: "p-bo", name: "Bo", kind: "mate", mate: { face: "" } },
          { projectId: "p-cy", name: "Shop - Cy", kind: "mate", mate: { face: "" } },
          { projectId: "p-stage", name: "Shop - stage", kind: "stage", mate: null },
          { projectId: "p-unread", name: "", kind: "mate", mate: { face: "" } },
        ],
      },
    ],
  };
  /** A listed project: a Mate's, with its container, or one no Mate lives in. */
  const listed = (id: string, name: string, mate = true) =>
    ({
      key: `${id}:zcp`,
      project: {
        id,
        name,
        status: "ACTIVE",
        tagList: mate ? ["mate"] : [],
        ...(mate
          ? { hq: { appId: "app-1", appName: "Shop", kind: "mate", mate: { face: "" } } }
          : {}),
      },
      group: mate ? "ready" : "unavailable",
      ...(mate ? { service: { id: "zcp", name: "zcp", status: "ACTIVE" } } : {}),
    }) as ZeropsCandidate;

  it("names each Mate by its own name under its application, from the listing first, else HQ's structure, and nothing else", () => {
    expect(
      Object.fromEntries(
        hqChatMateNames(
          [listed("p-ada", "Shop - Ada Lin"), listed("p-shop", "Shop", false)],
          STRUCTURE,
        ),
      ),
    ).toEqual({ "p-ada": "Ada Lin", "p-bo": "Bo", "p-cy": "Cy", "p-lone": "Lone" });
  });

  it("names each Mate's application the same way, for finding its chats by it", () => {
    expect(
      Object.fromEntries(hqChatMateApps([listed("p-ada", "Shop - Ada Lin")], STRUCTURE)),
    ).toEqual({ "p-ada": "Shop", "p-bo": "Shop", "p-cy": "Shop", "p-unread": "Shop" });
  });

  it("names only what the listing holds while HQ's structure is not known", () => {
    expect(Object.fromEntries(hqChatMateNames([listed("p-ada", "Ada")], null))).toEqual({
      "p-ada": "Ada",
    });
  });
});

describe('paletteNoMatchMessage: no "no matching" before the lists are read', () => {
  it.each([
    [
      "threads and projects not read yet: says nothing",
      { isActionsOnly: false, listsRead: false },
      "",
    ],
    [
      "read, nothing matches",
      { isActionsOnly: false, listsRead: true },
      "No matching commands, projects, or threads.",
    ],
    // Actions are the palette's own: known from the first frame.
    [
      "actions only, the lists not read yet",
      { isActionsOnly: true, listsRead: false },
      "No matching actions.",
    ],
    ["actions only, read", { isActionsOnly: true, listsRead: true }, "No matching actions."],
  ] as const)("%s", (_case, input, message) => {
    expect(paletteNoMatchMessage(input)).toBe(message);
  });
});

describe("palette list settlement includes HQ and stays with its organization", () => {
  const input = { organizationId: "org-a", bootstrapped: true, hqMatesRead: false } as const;
  it("an empty socket catalog cannot earn no matches while HQ is unread", () => {
    const state = paletteListsRead(null, input);
    expect(state.read).toBe(false);
    expect(paletteNoMatchMessage({ isActionsOnly: false, listsRead: state.read })).toBe("");
  });
  it("HQ answering cannot settle unread socket shells", () => {
    expect(paletteListsRead(null, { ...input, bootstrapped: false, hqMatesRead: true }).read).toBe(
      false,
    );
  });
  it("earns no matches once both sources settle and keeps it through reconnect", () => {
    const state = paletteListsRead(null, { ...input, hqMatesRead: true });
    expect(state.read).toBe(true);
    expect(paletteNoMatchMessage({ isActionsOnly: false, listsRead: state.read })).toBe(
      "No matching commands, projects, or threads.",
    );
    expect(paletteListsRead(state, { ...input, bootstrapped: false })).toBe(state);
  });
  it("an organization change waits for that organization's HQ", () => {
    const state = paletteListsRead(null, { ...input, hqMatesRead: true });
    const next = paletteListsRead(state, { ...input, organizationId: "org-b" });
    expect(next).toEqual({ organizationId: "org-b", read: false });
    expect(
      paletteListsRead(next, { ...input, organizationId: "org-b", hqMatesRead: true }).read,
    ).toBe(true);
  });
});

describe("restartCodingAgentPlan", () => {
  const session = (status: "running" | "starting" | "idle" | "ready" | "stopped") => ({
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "claudeAgent",
    providerInstanceId: ProviderInstanceId.make("claude-work"),
    runtimeMode: "full-access" as const,
    activeTurnId: null,
    lastError: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
  const rescan = (instanceId: string, cwd = "/workspace/project") => ({
    instanceId,
    cwd,
    fresh: true,
  });
  it.each([
    {
      name: "an idle session stops, and its own coding agent rescans the Mate's copy",
      thread: makeThread({ session: session("idle"), worktreePath: "/workspace/copy" }),
      plan: {
        available: true,
        stop: true,
        rescan: rescan("claude-work", "/workspace/copy"),
      },
    },
    {
      name: "a ready session stops: its process holds the old skills",
      thread: makeThread({ session: session("ready") }),
      plan: { available: true, stop: true, rescan: rescan("claude-work") },
    },
    {
      name: "a stopped session is not stopped again",
      thread: makeThread({ session: session("stopped") }),
      plan: { available: true, stop: false, rescan: rescan("claude-work") },
    },
    {
      name: "without a session the selected coding agent rescans",
      thread: makeThread(),
      plan: { available: true, stop: false, rescan: rescan("codex") },
    },
    {
      name: "nothing is rescanned when the Mate's folder is unknown",
      thread: makeThread(),
      workspaceRoot: null,
      plan: { available: true, stop: false, rescan: null },
    },
  ])(
    "restarting the coding agent is offered while it is idle: $name",
    ({ thread, plan, workspaceRoot }) => {
      expect(
        restartCodingAgentPlan(thread, workspaceRoot === null ? undefined : "/workspace/project"),
      ).toEqual(plan);
    },
  );

  // Stopping would end the run and cancel the messages still starting.
  it.each(["running", "starting"] as const)(
    "restarting the coding agent is unavailable while it works (%s), with the reason",
    (status) => {
      expect(
        restartCodingAgentPlan(makeThread({ session: session(status) }), "/workspace/project"),
      ).toEqual({ available: false, reason: "It is working. Stop the run first." });
    },
  );
});
