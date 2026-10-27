import * as NodeFS from "node:fs";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationSession,
} from "@t3tools/contracts";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";
import { threadStatusVectors } from "@t3tools/shared/threadStatus.vectors";
import { describe, expect, it, vi } from "vite-plus/test";

const tryOpenExternalUrl = vi.hoisted(() => vi.fn(async () => true));

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { select: (options: { readonly default?: unknown }) => options.default },
  Pressable: "Pressable",
  View: "View",
  useWindowDimensions: () => ({ width: 390 }),
}));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("../../components/AppText", () => ({ AppText: "Text" }));
vi.mock("../../components/ControlPill", () => ({ ControlPillMenu: "ControlPillMenu" }));
vi.mock("../../components/ProjectFavicon", () => ({ ProjectFavicon: "ProjectFavicon" }));
vi.mock("../../components/ProviderIcon", () => ({ ProviderIcon: "ProviderIcon" }));
vi.mock("../../components/RowPressable", () => ({ RowPressable: "RowPressable" }));
vi.mock("../../lib/openExternalUrl", () => ({ tryOpenExternalUrl }));
vi.mock("../../lib/copyTextWithHaptic", () => ({ copyTextWithHaptic: vi.fn() }));
vi.mock("../../lib/useUniwindTheme", () => ({
  useUniwindTheme: () => ({
    "--color-drawer": "drawer",
    "--color-screen": "screen",
    "--color-subtle": "subtle",
    "--color-user-bubble": "user-bubble",
  }),
}));
vi.mock("../../state/use-thread-pr", () => ({ useThreadPr: () => null }));
vi.mock("../home/thread-swipe-actions", () => ({ ThreadSwipeable: "ThreadSwipeable" }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));
vi.mock("./thread-search-match", () => ({ ThreadSearchMatchExcerpt: "ThreadSearchMatchExcerpt" }));

import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { threadJumpTarget } from "../keyboard/threadKeyboardShortcuts";
import {
  buildThreadListV2Items,
  buildThreadListV2ListItems,
  isThreadListV2ListItem,
  sortThreadsForListV2,
  threadListV2FailureDetail,
  threadListV2ListItemsAreEqual,
  threadListV2StatusPresentation,
  type ThreadListV2ListItem,
} from "./threadListV2";

const environmentId = EnvironmentId.make("environment-1");

function makeThread(
  input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "title">,
): EnvironmentThreadShell {
  return {
    environmentId,
    projectId: ProjectId.make("project-1"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  };
}

const NOW = "2026-06-02T00:00:00.000Z";

describe("ThreadListV2PullRequestLink", () => {
  it("renders #number with the exact external action and neutral presentation", async () => {
    const module = await import("./thread-list-v2-items");
    expect(module.ThreadListV2PullRequestLink).toBeTypeOf("function");
    if (typeof module.ThreadListV2PullRequestLink !== "function") return;

    const element = module.ThreadListV2PullRequestLink({
      pr: {
        number: 42,
        repository: "pingdotgg/t3code",
        url: "https://github.com/pingdotgg/t3code/pull/42",
        label: "42",
        accessibilityLabel: "#42 pull request",
        textClassName: "text-foreground-tertiary",
      },
      selected: false,
    });
    expect(element.props.accessibilityRole).toBe("link");
    expect(element.props.accessibilityLabel).toBe("#42 pull request");
    expect(element.props.children.props.children.join("")).toBe("#42");
    expect(element.props.children.props.className).toContain("text-foreground-tertiary");
    expect(element.props.children.props.className).not.toMatch(/emerald|violet|red/u);

    const stopPropagation = vi.fn();
    element.props.onPress({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(tryOpenExternalUrl).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/pingdotgg/t3code/pull/42",
      "pull-request",
    );
  });
});

describe("threadListV2StatusPresentation", () => {
  it.each(threadStatusVectors)("matches the shared status for $name", (vector) => {
    const status = resolveThreadStatus(vector.input);
    expect(status).toEqual(vector.expected);
    expect(threadListV2StatusPresentation(status).label).toBe(vector.expectedLabel);
  });

  it("emits only tone classes present in the generated Uniwind theme", () => {
    const themeCss = NodeFS.readFileSync(
      new URL("../../../generated-uniwind-themes.css", import.meta.url),
      "utf8",
    );
    const toneClasses = new Set(
      threadStatusVectors.map(
        (vector) => threadListV2StatusPresentation(vector.expected).className,
      ),
    );

    expect(toneClasses.size).toBe(7);
    for (const className of toneClasses) {
      expect(className.startsWith("text-")).toBe(true);
      expect(themeCss).toContain(`--color-${className.slice("text-".length)}:`);
    }
  });

  it("shows failure detail only for failed threads", () => {
    expect(threadListV2FailureDetail({ kind: "failed", toneId: "danger" }, "boom")).toBe("boom");
    expect(threadListV2FailureDetail({ kind: "working", toneId: "active" }, "boom")).toBeNull();
    expect(threadListV2FailureDetail({ kind: "failed", toneId: "danger" }, null)).toBeNull();
  });

  it("prioritizes approval over a running session", () => {
    const thread = makeThread({
      id: ThreadId.make("t"),
      title: "t",
      hasPendingApprovals: true,
      session: {
        threadId: ThreadId.make("t"),
        status: "running",
        providerName: "Codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });
    expect(resolveThreadStatus(thread).kind).toBe("approval");
  });

  it("resolves idle for quiescent threads", () => {
    expect(resolveThreadStatus(makeThread({ id: ThreadId.make("t"), title: "t" })).kind).toBe(
      "idle",
    );
  });

  it("renders Monitoring for background monitoring", () => {
    expect(
      threadListV2StatusPresentation(
        resolveThreadStatus({
          ...makeThread({ id: ThreadId.make("t"), title: "t" }),
          backgroundLiveness: "monitoring",
        }),
      ).label,
    ).toBe("Monitoring");
  });

  it("renders Connecting for a starting session", () => {
    const session: OrchestrationSession = {
      threadId: ThreadId.make("t"),
      status: "starting",
      providerName: "Codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: NOW,
    };
    expect(
      threadListV2StatusPresentation(
        resolveThreadStatus({ ...makeThread({ id: ThreadId.make("t"), title: "t" }), session }),
      ).label,
    ).toBe("Connecting");
  });
});

describe("sortThreadsForListV2", () => {
  it("orders by creation time, newest first, ignoring activity", () => {
    const sorted = sortThreadsForListV2([
      { id: "oldest", createdAt: "2026-06-01T08:00:00.000Z" },
      { id: "newest", createdAt: "2026-06-01T12:00:00.000Z" },
      { id: "middle", createdAt: "2026-06-01T10:00:00.000Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("surfaces an un-settled thread at the top via its re-entry stamp", () => {
    const sorted = sortThreadsForListV2([
      {
        id: "old-unsettled",
        createdAt: "2026-06-01T08:00:00.000Z",
        unsettledAt: "2026-06-01T13:00:00.000Z",
      },
      { id: "newest", createdAt: "2026-06-01T12:00:00.000Z" },
      { id: "middle", createdAt: "2026-06-01T10:00:00.000Z" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["old-unsettled", "newest", "middle"]);
  });
});

describe("buildThreadListV2Items", () => {
  it.each([
    { shelf: "active", extra: {} },
    { shelf: "pinned", extra: { pinnedAt: "2026-06-01T12:00:00.000Z" } },
    { shelf: "settled", extra: { settledOverride: "settled" as const } },
    { shelf: "snoozed", extra: { snoozedUntil: "2026-06-03T00:00:00.000Z" } },
  ])("never lists a crewmate's thread, not even as $shelf", ({ extra }) => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("person"), title: "Checkout flow" }),
        makeThread({
          id: ThreadId.make("stint"),
          title: "backend",
          crew: { crew: "shop", crewmate: "backend", stint: 1 },
          ...extra,
        }),
      ],
      environmentId: null,
      searchQuery: "",
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["person"]);
  });

  it("filters the list by title", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("match"), title: "Fix login bug" }),
        makeThread({ id: ThreadId.make("miss"), title: "Greeting" }),
      ],
      environmentId: null,
      searchQuery: "login",
    });

    expect(items.map((item) => item.thread.id)).toEqual(["match"]);
  });

  it("includes a thread matched by message content", () => {
    const thread = makeThread({
      id: ThreadId.make("content-match"),
      title: "Unrelated title",
    });
    const { items } = buildThreadListV2Items({
      threads: [thread],
      environmentId: null,
      searchQuery: "relay reconnect",
      matchedThreadKeys: new Set([
        threadSearchMatchKey({
          environmentId,
          threadId: thread.id,
        }),
      ]),
    });

    expect(items.map((item) => item.thread.id)).toEqual(["content-match"]);
  });

  it("scopes the flat list to one project", () => {
    const otherProjectId = ProjectId.make("project-2");
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("included"), title: "Included" }),
        makeThread({
          id: ThreadId.make("excluded"),
          projectId: otherProjectId,
          title: "Excluded",
        }),
      ],
      environmentId: null,
      projectRefs: [{ environmentId, projectId: ProjectId.make("project-1") }],
      searchQuery: "",
    });

    expect(items.map((item) => item.thread.id)).toEqual(["included"]);
  });

  it("scopes the flat list to every environment member of a logical project", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("local"), title: "Local" }),
        makeThread({
          environmentId: remoteEnvironmentId,
          id: ThreadId.make("remote"),
          title: "Remote",
        }),
      ],
      environmentId: null,
      projectRefs: [
        { environmentId, projectId: ProjectId.make("project-1") },
        { environmentId: remoteEnvironmentId, projectId: ProjectId.make("project-1") },
      ],
      searchQuery: "",
    });

    expect(items.map((item) => item.thread.id)).toEqual(["local", "remote"]);
  });
});

function makePendingTask(id: string): PendingNewTask {
  const creation = {
    projectId: ProjectId.make("project-1"),
    workspaceMode: "worktree" as const,
    branch: null,
    worktreePath: null,
  };
  return {
    kind: "pending",
    key: `pending-task:${id}`,
    environmentId,
    projectId: creation.projectId,
    projectTitle: undefined,
    projectCwd: undefined,
    branch: null,
    title: id,
    createdAt: NOW,
    message: {
      environmentId,
      threadId: ThreadId.make(`thread-${id}`),
      messageId: MessageId.make(id),
      commandId: CommandId.make(`command-${id}`),
      text: id,
      attachments: [],
      createdAt: NOW,
      creation,
    },
    creation,
  };
}

describe("buildThreadListV2ListItems", () => {
  it("ends the list with queued tasks after the threads", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("first"), title: "first" }),
        makeThread({
          id: ThreadId.make("second"),
          title: "second",
          createdAt: "2026-05-31T00:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
    });
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("queued-1"), makePendingTask("queued-2")],
    });

    expect(
      items.map((item) =>
        item.type === "v2-pending" ? item.pendingTask.title : item.item.thread.id,
      ),
    ).toEqual(["first", "second", "queued-1", "queued-2"]);
    // Only the leading queued row labels the section.
    expect(
      items.filter((item) => item.type === "v2-pending" && item.showPendingDivider),
    ).toHaveLength(1);
    expect(threadJumpTarget(items, "thread.jump.1")?.id).toBe("first");
    expect(threadJumpTarget(items, "thread.jump.2")?.id).toBe("second");
    expect(threadJumpTarget(items, "thread.jump.3")).toBeNull();
  });
});

/* ─── Recycled-list equality + per-row clock scoping ─────────────────── */

const BASE_MS = Date.parse(NOW);
const isoAt = (ms: number) => new Date(ms).toISOString();
const MINUTE_MS = 60_000;

function buildTickThreads() {
  return {
    ready: makeThread({
      id: ThreadId.make("tick-ready"),
      title: "tick ready",
      latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
    }),
    approval: makeThread({
      id: ThreadId.make("tick-approval"),
      title: "tick approval",
      hasPendingApprovals: true,
      latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
    }),
    quiet: makeThread({
      id: ThreadId.make("tick-quiet"),
      title: "tick quiet",
      latestUserMessageAt: isoAt(BASE_MS - 3 * 24 * 60 * MINUTE_MS),
    }),
  };
}

function buildTickList(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  pendingTasks: ReadonlyArray<PendingNewTask>,
  queuedThreadKeys?: ReadonlySet<string>,
): ThreadListV2ListItem[] {
  const layout = buildThreadListV2Items({ threads, environmentId: null, searchQuery: "" });
  return buildThreadListV2ListItems({
    items: layout.items,
    pendingTasks,
    ...(queuedThreadKeys ? { queuedThreadKeys } : {}),
  });
}

function itemsByThreadKey(items: ReadonlyArray<ThreadListV2ListItem>) {
  const byKey = new Map<string, ThreadListV2ListItem>();
  for (const item of items) byKey.set(item.key, item);
  return byKey;
}

describe("threadListV2ListItemsAreEqual", () => {
  const thread = makeThread({
    id: ThreadId.make("eq"),
    title: "eq",
    latestUserMessageAt: isoAt(BASE_MS - 5 * MINUTE_MS),
  });
  const layout = buildThreadListV2Items({
    threads: [thread],
    environmentId: null,
    searchQuery: "",
  });
  // One queued task object shared across builds: identity, not content, is
  // what the row equality compares (mirrors the store's stable references).
  const queued = makePendingTask("eq-queued");
  const build = () =>
    buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [queued],
    });

  it("treats rebuilt wrappers over identical rows as equal", () => {
    const first = build();
    const second = build();
    expect(first.length).toBe(second.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]).not.toBe(second[index]);
      expect(threadListV2ListItemsAreEqual(first[index]!, second[index]!)).toBe(true);
    }
  });

  it("notices a replaced thread shell", () => {
    const replacement = makeThread({ id: ThreadId.make("eq"), title: "renamed" });
    const rebuilt = buildThreadListV2Items({
      threads: [replacement],
      environmentId: null,
      searchQuery: "",
    });
    const next = buildThreadListV2ListItems({
      items: rebuilt.items,
      pendingTasks: [],
    });
    const previousThread = build().find((item) => item.type === "v2-thread")!;
    const nextThread = next.find((item) => item.type === "v2-thread")!;
    expect(threadListV2ListItemsAreEqual(previousThread, nextThread)).toBe(false);
  });

  it("treats different item kinds as unequal", () => {
    const built = build();
    const threadItem = built.find((item) => item.type === "v2-thread")!;
    const pendingItem = built.find((item) => item.type === "v2-pending")!;
    expect(threadListV2ListItemsAreEqual(threadItem, pendingItem)).toBe(false);
  });
});

describe("isThreadListV2ListItem", () => {
  it("narrows the v2 kinds and rejects other discriminators", () => {
    expect(isThreadListV2ListItem({ type: "v2-thread" })).toBe(true);
    expect(isThreadListV2ListItem({ type: "v2-pending" })).toBe(true);
    expect(isThreadListV2ListItem({ type: "thread" })).toBe(false);
    expect(isThreadListV2ListItem({ type: "v2-settled-shelf" })).toBe(false);
  });
});

describe("buildThreadListV2ListItems clock scoping", () => {
  it("blanks the precomputed time for rows that render a label instead", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const items = buildTickList(Object.values(buildTickThreads()), []);
      const byKey = itemsByThreadKey(items);
      const label = (id: string) => {
        const item = byKey.get(`v2-thread:${environmentId}:${id}`)!;
        return item.type === "v2-thread" ? item.timeLabel : "<not a row>";
      };
      // Ready rows draw their latest activity; the status label outranks the
      // time on the approval row.
      expect(label("tick-ready")).toBe("5m");
      expect(label("tick-quiet")).toBe("3d");
      expect(label("tick-approval")).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("thread list v2 minute tick invalidation", () => {
  it("only invalidates rows whose clock-driven content moved", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const threads = buildTickThreads();
      const shellOrder = [threads.ready, threads.approval, threads.quiet];
      const pendingTasks = [makePendingTask("tick-q")];
      const atStart = buildTickList(shellOrder, pendingTasks);
      vi.setSystemTime(BASE_MS + MINUTE_MS);
      const atNextMinute = buildTickList(shellOrder, pendingTasks);

      expect(atStart.length).toBe(atNextMinute.length);
      const invalidated: string[] = [];
      for (let index = 0; index < atStart.length; index += 1) {
        if (!threadListV2ListItemsAreEqual(atStart[index]!, atNextMinute[index]!)) {
          invalidated.push(atStart[index]!.key);
        }
      }
      // Only the ready row's time moves; the approval row, the day-old row
      // and the queued row survive untouched.
      expect(invalidated).toEqual([`v2-thread:${environmentId}:tick-ready`]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildThreadListV2ListItems trailing dividers", () => {
  it("follows the final neighbour order, not the pre-splice blocks", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("div-a"), title: "a" }),
        makeThread({ id: ThreadId.make("div-b"), title: "b" }),
      ],
      environmentId: null,
      searchQuery: "",
    });
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("div-q1"), makePendingTask("div-q2")],
    });
    const dividers = items.map((item) => item.showTrailingDivider);
    // thread | thread | queued | queued: consecutive threads keep their
    // hairlines, the row above the queued section rule loses its own, queued
    // rows divide each other, and the last row has nothing under it.
    expect(dividers).toEqual([true, false, true, false]);
  });
});

describe("buildThreadListV2ListItems row-state stamps", () => {
  it("stamps queued outbox messages onto the matching row and notices removal", () => {
    const { ready, quiet } = buildTickThreads();
    const queued = buildTickList([ready, quiet], [], new Set([`${environmentId}:tick-ready`]));
    const plain = buildTickList([ready, quiet], [], new Set<string>());
    const row = (items: ThreadListV2ListItem[], id: string) =>
      itemsByThreadKey(items).get(`v2-thread:${environmentId}:${id}`)!;
    const queuedRow = row(queued, "tick-ready");
    const plainRow = row(plain, "tick-ready");
    expect(queuedRow.type === "v2-thread" && queuedRow.hasQueuedMessages).toBe(true);
    expect(plainRow.type === "v2-thread" && plainRow.hasQueuedMessages).toBe(false);
    expect(threadListV2ListItemsAreEqual(queuedRow, plainRow)).toBe(false);
    expect(threadListV2ListItemsAreEqual(row(queued, "tick-quiet"), row(plain, "tick-quiet"))).toBe(
      true,
    );
  });
});
