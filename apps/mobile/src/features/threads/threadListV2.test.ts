import * as NodeFS from "node:fs";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
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
  resolveThreadListV2ChangeRequestState,
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2SnoozeGateExpiryMs,
  resolveThreadListV2SwipeActions,
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
const linkedPullRequest = {
  projectId: ProjectId.make("project-1"),
  repository: "pingdotgg/t3code",
  number: 42,
  url: "https://github.com/pingdotgg/t3code/pull/42",
};

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

describe("resolveThreadListV2ChangeRequestState", () => {
  it("clears settlement state when there is no checkout pull request", () => {
    expect(
      resolveThreadListV2ChangeRequestState({
        state: null,
        updatedAt: null,
      }),
    ).toBeNull();
  });

  it("reports a checkout pull request with real state", () => {
    expect(
      resolveThreadListV2ChangeRequestState({
        state: "merged",
        updatedAt: "2026-06-02T00:00:00.000Z",
      }),
    ).toEqual({
      state: "merged",
      updatedAt: "2026-06-02T00:00:00.000Z",
    });
  });
});

describe("resolveThreadListV2SnoozeMenuSelection", () => {
  it("accepts a displayed evening preset while its wake time is still future", () => {
    const menuOpenedAt = new Date(2026, 4, 8, 16, 59, 30);
    const selectedAt = new Date(2026, 4, 8, 17, 0, 30);
    const displayedPresets = resolveSnoozePresets(menuOpenedAt);

    const selection = resolveThreadListV2SnoozeMenuSelection({
      event: "snooze:evening",
      displayedPresets,
      now: selectedAt,
    });

    expect(selection).toEqual({
      _tag: "selected",
      preset: displayedPresets.find((preset) => preset.id === "evening"),
    });
  });

  it("expires a displayed preset once its wake time has passed", () => {
    const displayedPresets = resolveSnoozePresets(new Date(2026, 4, 8, 16, 59, 30));

    expect(
      resolveThreadListV2SnoozeMenuSelection({
        event: "snooze:evening",
        displayedPresets,
        now: new Date(2026, 4, 8, 18, 0, 1),
      }),
    ).toEqual({ _tag: "expired" });
  });

  it("recomputes presets that remain available instead of using old timestamps", () => {
    const displayedPresets = resolveSnoozePresets(new Date(2026, 4, 8, 10));
    const selectedAt = new Date(2026, 4, 8, 10, 30);
    const selection = resolveThreadListV2SnoozeMenuSelection({
      event: "snooze:hour",
      displayedPresets,
      now: selectedAt,
    });

    expect(selection._tag).toBe("selected");
    if (selection._tag === "selected") {
      expect(selection.preset.snoozedUntil).toBe(
        new Date(selectedAt.getTime() + 60 * 60 * 1_000).toISOString(),
      );
    }
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
    expect(
      threadListV2StatusPresentation(
        resolveThreadStatus({
          ...makeThread({ id: ThreadId.make("t"), title: "t" }),
          session: {
            threadId: ThreadId.make("t"),
            status: "starting",
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
        }),
      ).label,
    ).toBe("Connecting");
  });
});

describe("queued messages keep a settled thread active", () => {
  const threads = [
    makeThread({ id: ThreadId.make("active"), title: "Active" }),
    makeThread({ id: ThreadId.make("settled"), title: "Settled", settledOverride: "settled" }),
    makeThread({
      id: ThreadId.make("settled-queued"),
      title: "Settled with outbox",
      settledOverride: "settled",
    }),
  ];
  const queuedThreadKeys = new Set([`${environmentId}:settled-queued`]);

  it("lists the thread in the active block instead of the settled shelf", () => {
    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      queuedThreadKeys,
    });
    expect(layout.items.map((item) => [item.thread.id, item.variant] as const)).toEqual([
      ["active", "card"],
      ["settled-queued", "card"],
      ["settled", "slim"],
    ]);
    expect(layout.settledCount).toBe(1);
  });
});

describe("resolveThreadListV2SwipeActions", () => {
  it("offers settle and snooze for an active snoozable thread", () => {
    expect(
      resolveThreadListV2SwipeActions({
        variant: "card",
        settlementSupported: true,
        snoozeSupported: true,
        snoozable: true,
      }),
    ).toEqual({ primary: "settle", secondary: "snooze" });
  });

  it("offers un-settle and snooze for settled history", () => {
    expect(
      resolveThreadListV2SwipeActions({
        variant: "slim",
        settlementSupported: true,
        snoozeSupported: true,
        snoozable: true,
      }),
    ).toEqual({ primary: "unsettle", secondary: "snooze" });
  });

  it("omits snooze when the server or thread does not allow it", () => {
    expect(
      resolveThreadListV2SwipeActions({
        variant: "card",
        settlementSupported: true,
        snoozeSupported: false,
        snoozable: true,
      }),
    ).toEqual({ primary: "settle", secondary: null });
    expect(
      resolveThreadListV2SwipeActions({
        variant: "card",
        settlementSupported: true,
        snoozeSupported: true,
        snoozable: false,
      }),
    ).toEqual({ primary: "settle", secondary: null });
  });

  it("falls back to archive only for a pre-lifecycle server", () => {
    expect(
      resolveThreadListV2SwipeActions({
        variant: "card",
        settlementSupported: false,
        snoozeSupported: false,
        snoozable: true,
      }),
    ).toEqual({ primary: "archive", secondary: null });
  });

  it("offers wake and no snooze on a snoozed row", () => {
    expect(
      resolveThreadListV2SwipeActions({
        variant: "slim",
        settlementSupported: true,
        snoozeSupported: true,
        snoozable: true,
        snoozed: true,
      }),
    ).toEqual({ primary: "unsnooze", secondary: null });
  });
});

describe("resolveThreadListV2SnoozeGateExpiryMs", () => {
  it("reports when an unadopted turn's grace window lapses", () => {
    const thread = makeThread({
      id: ThreadId.make("t"),
      title: "t",
      latestUserMessageAt: "2026-06-02T00:00:30.000Z",
    });
    expect(resolveThreadListV2SnoozeGateExpiryMs(thread, { now: "2026-06-02T00:01:00.000Z" })).toBe(
      Date.parse("2026-06-02T00:02:30.000Z"),
    );
  });

  it("returns null once the thread is snoozable or when only data can unblock it", () => {
    expect(
      resolveThreadListV2SnoozeGateExpiryMs(
        makeThread({ id: ThreadId.make("ready"), title: "Ready" }),
        { now: NOW },
      ),
    ).toBe(null);
    expect(
      resolveThreadListV2SnoozeGateExpiryMs(
        makeThread({
          id: ThreadId.make("blocked"),
          title: "Blocked",
          hasPendingApprovals: true,
          latestUserMessageAt: NOW,
        }),
        { now: NOW },
      ),
    ).toBe(null);
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
  it("ignores checkout pull request state when a static pull request is linked", () => {
    const thread = makeThread({
      id: ThreadId.make("linked"),
      title: "Linked pull request",
      linkedPullRequest,
    });
    const layout = buildThreadListV2Items({
      threads: [thread],
      environmentId: null,
      searchQuery: "",
      changeRequestByKey: new Map([
        [
          `${environmentId}:${thread.id}`,
          {
            state: "merged" as const,
          },
        ],
      ]),
      now: NOW,
    });

    expect(layout.settledCount).toBe(0);
    expect(layout.items[0]?.variant).toBe("card");
  });

  it("settles an unlinked thread from its checkout pull request state", () => {
    const thread = makeThread({
      id: ThreadId.make("checkout-merged"),
      title: "Checkout merged pull request",
    });
    const layout = buildThreadListV2Items({
      threads: [thread],
      environmentId: null,
      searchQuery: "",
      changeRequestByKey: new Map([
        [
          `${environmentId}:${thread.id}`,
          {
            state: "merged" as const,
          },
        ],
      ]),
      now: NOW,
    });

    expect(layout.settledCount).toBe(1);
    expect(layout.items[0]?.variant).toBe("slim");
  });

  it("keeps a merged thread active when auto-settle on merge is off", () => {
    const merged = makeThread({ id: ThreadId.make("merged"), title: "Merged" });
    const layout = buildThreadListV2Items({
      threads: [merged],
      environmentId: null,
      searchQuery: "",
      changeRequestByKey: new Map([
        [`${environmentId}:${merged.id}`, { state: "merged" as const }],
      ]),
      autoSettleOnMerge: false,
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["merged"]);
    expect(layout.settledCount).toBe(0);
  });

  it("hides snoozed threads and counts them — visibility parity with web", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("woken"),
          title: "Woken",
          // Wake time already passed: back in the active list.
          snoozedUntil: "2026-06-01T18:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    // Same createdAt → static sort tiebreaks by id; the point is the woken
    // thread is BACK in the card block and the snoozed one is gone.
    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "woken"]);
    expect(layout.snoozedCount).toBe(1);
  });

  it("places settled pinned threads in the settled shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("pinned-settled"),
          title: "Pinned while settled",
          pinnedAt: "2026-06-01T12:00:00.000Z",
          settledOverride: "settled",
          settledAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "pinned-settled"]);
    expect(layout.items.map((item) => item.pinned)).toEqual([false, false]);
    expect(layout.settledCount).toBe(1);
  });

  it("moves pinned threads to the settled shelf when their pull request merges", () => {
    const merged = makeThread({
      id: ThreadId.make("pinned-merged"),
      title: "Pinned merged pull request",
      pinnedAt: "2026-06-01T12:00:00.000Z",
    });
    const layout = buildThreadListV2Items({
      threads: [makeThread({ id: ThreadId.make("active"), title: "Active" }), merged],
      environmentId: null,
      searchQuery: "",
      changeRequestByKey: new Map([[`${environmentId}:${merged.id}`, { state: "merged" }]]),
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active", "pinned-merged"]);
    expect(layout.items.map((item) => item.variant)).toEqual(["card", "slim"]);
    expect(layout.items[1]?.thread.pinnedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(layout.settledCount).toBe(1);
  });

  it("moves inactive pinned threads to the settled shelf", () => {
    const inactive = makeThread({
      id: ThreadId.make("pinned-inactive"),
      title: "Pinned inactive thread",
      createdAt: "2026-05-20T00:00:00.000Z",
      pinnedAt: "2026-05-21T00:00:00.000Z",
      latestTurn: {
        turnId: TurnId.make("turn-inactive"),
        state: "completed",
        requestedAt: "2026-05-21T00:00:00.000Z",
        startedAt: "2026-05-21T00:00:01.000Z",
        completedAt: "2026-05-21T00:00:02.000Z",
        assistantMessageId: null,
      },
    });
    const layout = buildThreadListV2Items({
      threads: [inactive],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items[0]).toMatchObject({
      thread: { id: "pinned-inactive" },
      variant: "slim",
      pinned: false,
    });
    expect(layout.settledCount).toBe(1);
  });

  it("keeps pinned merged threads pinned when auto-settle on merge is off", () => {
    const merged = makeThread({
      id: ThreadId.make("pinned-merged"),
      title: "Pinned merged pull request",
      pinnedAt: "2026-06-01T12:00:00.000Z",
    });
    const layout = buildThreadListV2Items({
      threads: [merged],
      environmentId: null,
      searchQuery: "",
      changeRequestByKey: new Map([[`${environmentId}:${merged.id}`, { state: "merged" }]]),
      autoSettleOnMerge: false,
      now: NOW,
    });

    expect(layout.items[0]).toMatchObject({
      thread: { id: "pinned-merged" },
      variant: "card",
      pinned: true,
    });
    expect(layout.settledCount).toBe(0);
  });

  it("snooze hides a pinned thread and wake restores it to the pinned block", () => {
    const snoozedInput = {
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("pinned-snoozed"),
          title: "Pinned and snoozed",
          pinnedAt: "2026-06-01T12:00:00.000Z",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T11:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
    };

    // Before the wake time: the snooze wins; the pin holds underneath.
    const whileSnoozed = buildThreadListV2Items({ ...snoozedInput, now: NOW });
    expect(whileSnoozed.items.map((item) => item.thread.id)).toEqual(["active"]);
    expect(whileSnoozed.snoozedCount).toBe(1);

    // After the wake time: the thread returns pinned, back on top.
    const afterWake = buildThreadListV2Items({ ...snoozedInput, now: "2026-06-03T10:00:00.000Z" });
    expect(afterWake.items.map((item) => item.thread.id)).toEqual(["pinned-snoozed", "active"]);
    expect(afterWake.items[0]?.pinned).toBe(true);
    expect(afterWake.snoozedCount).toBe(0);
  });

  it("classifies snooze with the second-precise clock and reports the next wake", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("just-woke"),
          title: "Just woke",
          // Woke 30s ago: hidden under the minute-floored clock, visible
          // under the precise one.
          snoozedUntil: "2026-06-02T00:00:30.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("still-snoozed"),
          title: "Still snoozed",
          snoozedUntil: "2026-06-02T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      // Minute-floored partition clock vs precise snooze clock.
      now: "2026-06-02T00:01:00.000Z",
      snoozeNow: "2026-06-02T00:01:07.500Z",
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["just-woke"]);
    expect(layout.snoozedCount).toBe(1);
    expect(layout.nextSnoozeWakeAt).toBe("2026-06-02T09:00:00.000Z");
  });

  it("builds snoozed rows between active and settled when the shelf is expanded", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("later"),
          title: "Wakes later",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("sooner"),
          title: "Wakes sooner",
          snoozedUntil: "2026-06-02T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      snoozedShelfExpanded: true,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual([
      "active",
      "sooner",
      "later",
      "settled",
    ]);
    expect(layout.items.map((item) => item.snoozed)).toEqual([false, true, true, false]);
    expect(layout.snoozedShelfHeaderIndex).toBe(1);
    expect(layout.snoozedCount).toBe(2);
  });

  it("collapses to a header-only shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items).toEqual([]);
    expect(layout.snoozedCount).toBe(1);
    expect(layout.snoozedShelfHeaderIndex).toBe(0);
  });

  it("keeps the selected thread on a collapsed shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("open"),
          title: "Open",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("other"),
          title: "Other",
          snoozedUntil: "2026-06-03T10:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      selectedThreadKey: `${environmentId}:open`,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["open"]);
    expect(layout.items[0]?.snoozed).toBe(true);
    expect(layout.snoozedCount).toBe(2);
  });

  it("keeps snoozed threads visible on environments without the snooze capability", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "Snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      snoozeEnvironmentIds: new Set(),
      now: NOW,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["snoozed"]);
    expect(layout.snoozedCount).toBe(0);
  });

  it("partitions settled threads into a slim shelf", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("settled-2"),
          title: "Settled 2",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(layout.items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["active", "card"],
      ["settled", "slim"],
      ["settled-2", "slim"],
    ]);
    expect(layout.items.map((item) => item.isLast)).toEqual([false, false, true]);
    expect(layout.settledCount).toBe(2);
    expect(layout.settledShelfHeaderIndex).toBe(1);
  });

  it("collapses settled threads to a counted shelf header", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "Active" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      settledShelfExpanded: false,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["active"]);
    expect(layout.settledCount).toBe(1);
    expect(layout.settledShelfHeaderIndex).toBe(1);
  });

  it("keeps the selected settled thread visible when its shelf is collapsed", () => {
    const layout = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("selected"),
          title: "Selected",
          settledOverride: "settled",
          settledAt: NOW,
        }),
        makeThread({
          id: ThreadId.make("other"),
          title: "Other",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
      settledShelfExpanded: false,
      selectedThreadKey: `${environmentId}:selected`,
    });

    expect(layout.items.map((item) => item.thread.id)).toEqual(["selected"]);
    expect(layout.settledCount).toBe(2);
    expect(layout.settledShelfHeaderIndex).toBe(0);
  });

  it("keeps cards in creation order while settled sorts by recency", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({
          id: ThreadId.make("older-created"),
          title: "Older",
          createdAt: "2026-06-01T08:00:00.000Z",
          updatedAt: NOW, // recent activity must NOT promote it
        }),
        makeThread({
          id: ThreadId.make("newer-created"),
          title: "Newer",
          createdAt: "2026-06-01T12:00:00.000Z",
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["newer-created", "older-created"]);
  });

  it("keeps settled threads in the tail and filters by search query", () => {
    const { items } = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("match"), title: "Fix login bug" }),
        makeThread({ id: ThreadId.make("miss"), title: "Greeting" }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "Fix login again",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "login",
      now: NOW,
    });

    expect(items.map((item) => [item.thread.id, item.variant])).toEqual([
      ["match", "card"],
      ["settled", "slim"],
    ]);
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
      now: NOW,
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
      now: NOW,
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
      now: NOW,
    });

    expect(items.map((item) => item.thread.id)).toEqual(["local", "remote"]);
  });
});

describe("buildThreadListV2Items settled paging", () => {
  it("caps the settled tail at settledLimit and reports the hidden count", () => {
    const threads = [
      makeThread({ id: ThreadId.make("active"), title: "Active" }),
      ...Array.from({ length: 4 }, (_, index) =>
        makeThread({
          id: ThreadId.make(`settled-${index}`),
          title: `Settled ${index}`,
          settledOverride: "settled",
          settledAt: NOW,
          latestUserMessageAt: `2026-06-01T0${index}:00:00.000Z`,
          // A turn adopted the message (same requestedAt): without it the
          // thread reads as a queued turn start, which never settles.
          latestTurn: {
            turnId: TurnId.make(`turn-${index}`),
            state: "completed",
            requestedAt: `2026-06-01T0${index}:00:00.000Z`,
            startedAt: `2026-06-01T0${index}:00:00.000Z`,
            completedAt: `2026-06-01T0${index}:10:00.000Z`,
            assistantMessageId: null,
          },
        }),
      ),
    ];

    const layout = buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      settledLimit: 2,
      now: NOW,
    });

    expect(layout.hiddenSettledCount).toBe(2);
    expect(layout.items.filter((item) => item.variant === "slim")).toHaveLength(2);
    // Most recent settled first — the hidden ones are the oldest.
    expect(layout.items.map((item) => item.thread.id)).toEqual([
      "active",
      "settled-3",
      "settled-2",
    ]);
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
  const layout = buildThreadListV2Items({
    threads: [
      makeThread({ id: ThreadId.make("active"), title: "active" }),
      makeThread({
        id: ThreadId.make("settled"),
        title: "settled",
        settledOverride: "settled",
        settledAt: NOW,
      }),
    ],
    environmentId: null,
    searchQuery: "",
    now: NOW,
  });

  it("splices queued tasks between the active block and the settled tail", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("queued-1"), makePendingTask("queued-2")],
      settledCount: layout.settledCount,
      settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
    });

    expect(
      items.map((item) =>
        item.type === "v2-pending"
          ? item.pendingTask.title
          : item.type === "v2-thread"
            ? item.item.thread.id
            : item.type === "v2-snoozed-shelf"
              ? "snoozed-shelf"
              : "settled-shelf",
      ),
    ).toEqual(["active", "queued-1", "queued-2", "settled-shelf", "settled"]);
    // Only the leading queued row labels the section, exactly like Settled.
    expect(
      items.filter((item) => item.type === "v2-pending" && item.showPendingDivider),
    ).toHaveLength(1);
  });

  it("ends the list with queued tasks when nothing has settled yet", () => {
    const activeOnly = buildThreadListV2Items({
      threads: [makeThread({ id: ThreadId.make("active"), title: "active" })],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: activeOnly.items,
      pendingTasks: [makePendingTask("queued-1")],
    });

    expect(items.map((item) => item.type)).toEqual(["v2-thread", "v2-pending"]);
  });

  it("keeps the settled shelf between active and settled rows when nothing is queued", () => {
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [],
      settledCount: layout.settledCount,
      settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
    });

    expect(items.map((item) => item.key)).toEqual([
      `v2-thread:${environmentId}:active`,
      "v2-settled-shelf",
      `v2-thread:${environmentId}:settled`,
    ]);
  });

  it("places queued tasks before a collapsed snoozed shelf", () => {
    const snoozedLayout = buildThreadListV2Items({
      threads: [
        makeThread({ id: ThreadId.make("active"), title: "active" }),
        makeThread({
          id: ThreadId.make("snoozed"),
          title: "snoozed",
          snoozedUntil: "2026-06-03T09:00:00.000Z",
          snoozedAt: "2026-06-01T12:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("settled"),
          title: "settled",
          settledOverride: "settled",
          settledAt: NOW,
        }),
      ],
      environmentId: null,
      searchQuery: "",
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: snoozedLayout.items,
      pendingTasks: [makePendingTask("queued")],
      snoozedCount: snoozedLayout.snoozedCount,
      snoozedShelfExpanded: false,
      snoozedShelfHeaderIndex: snoozedLayout.snoozedShelfHeaderIndex,
      settledCount: snoozedLayout.settledCount,
      settledShelfHeaderIndex: snoozedLayout.settledShelfHeaderIndex,
    });

    expect(items.map((item) => item.type)).toEqual([
      "v2-thread",
      "v2-pending",
      "v2-snoozed-shelf",
      "v2-settled-shelf",
      "v2-thread",
    ]);
    expect(threadJumpTarget(items, "thread.jump.1")?.id).toBe("active");
    expect(threadJumpTarget(items, "thread.jump.2")?.id).toBe("settled");
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
    settled: makeThread({
      id: ThreadId.make("tick-settled"),
      title: "tick settled",
      settledOverride: "settled",
      settledAt: isoAt(BASE_MS - 3 * 24 * 60 * MINUTE_MS),
      latestUserMessageAt: isoAt(BASE_MS - 3 * 24 * 60 * MINUTE_MS),
    }),
    snoozed: makeThread({
      id: ThreadId.make("tick-snoozed"),
      title: "tick snoozed",
      snoozedAt: isoAt(BASE_MS - MINUTE_MS),
      snoozedUntil: isoAt(BASE_MS + 2 * 60 * MINUTE_MS),
    }),
  };
}

function buildTickList(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  clockMs: number,
  pendingTasks: ReadonlyArray<PendingNewTask>,
  options?: {
    readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
    readonly queuedThreadKeys?: ReadonlySet<string>;
    readonly pinnedOrderKeys?: ReadonlyArray<string>;
    readonly shelfPreferencesLoading?: boolean;
  },
): ThreadListV2ListItem[] {
  const now = isoAt(clockMs);
  const layout = buildThreadListV2Items({
    threads,
    environmentId: null,
    searchQuery: "",
    now,
    snoozedShelfExpanded: true,
  });
  return buildThreadListV2ListItems({
    items: layout.items,
    pendingTasks,
    snoozedCount: layout.snoozedCount,
    snoozedShelfExpanded: true,
    snoozedShelfHeaderIndex: layout.snoozedShelfHeaderIndex,
    settledCount: layout.settledCount,
    settledShelfHeaderIndex: layout.settledShelfHeaderIndex,
    snoozeLabelNow: now,
    ...(options?.snoozeEnvironmentIds
      ? { snoozeEnvironmentIds: options.snoozeEnvironmentIds }
      : {}),
    ...(options?.queuedThreadKeys ? { queuedThreadKeys: options.queuedThreadKeys } : {}),
    ...(options?.pinnedOrderKeys ? { pinnedOrderKeys: options.pinnedOrderKeys } : {}),
    ...(options?.shelfPreferencesLoading !== undefined
      ? { shelfPreferencesLoading: options.shelfPreferencesLoading }
      : {}),
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
    now: NOW,
  });
  // One queued task object shared across builds: identity, not content, is
  // what the row equality compares (mirrors the store's stable references).
  const queued = makePendingTask("eq-queued");
  const build = () =>
    buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [queued],
      snoozeLabelNow: NOW,
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
      now: NOW,
    });
    const next = buildThreadListV2ListItems({
      items: rebuilt.items,
      pendingTasks: [],
      snoozeLabelNow: NOW,
    });
    const previousThread = build().find((item) => item.type === "v2-thread")!;
    const nextThread = next.find((item) => item.type === "v2-thread")!;
    expect(threadListV2ListItemsAreEqual(previousThread, nextThread)).toBe(false);
  });

  it("notices shelf count, expansion, and loading-disabled changes", () => {
    const shelf = {
      type: "v2-settled-shelf",
      key: "v2-settled-shelf",
      count: 2,
      expanded: true,
      disabled: false,
    } as const;
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf })).toBe(true);
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf, count: 3 })).toBe(false);
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf, expanded: false })).toBe(false);
    // A recycled cell ignores the render closure, so the shelf header's
    // preference-loading disabled state has to ride on the item too.
    expect(threadListV2ListItemsAreEqual(shelf, { ...shelf, disabled: true })).toBe(false);
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
    expect(isThreadListV2ListItem({ type: "v2-snoozed-shelf" })).toBe(true);
    expect(isThreadListV2ListItem({ type: "v2-settled-shelf" })).toBe(true);
    expect(isThreadListV2ListItem({ type: "thread" })).toBe(false);
    expect(isThreadListV2ListItem({ type: "v2-show-more" })).toBe(false);
  });
});

describe("buildThreadListV2ListItems clock scoping", () => {
  const allEnvironments = new Set<EnvironmentId>([environmentId]);

  it("carries the snooze menu clock only on rows whose swipe menu offers presets", () => {
    const threads = buildTickThreads();
    const items = buildTickList(Object.values(threads), BASE_MS, [makePendingTask("tick-q")], {
      snoozeEnvironmentIds: allEnvironments,
    });
    const byKey = itemsByThreadKey(items);
    const clock = (id: string) => {
      const item = byKey.get(`v2-thread:${environmentId}:${id}`)!;
      return item.type === "v2-thread" ? item.snoozePresetMinute : "<not a row>";
    };
    expect(clock("tick-ready")).toBe(NOW);
    // The swipe-revealed snooze action exists on slim rows too.
    expect(clock("tick-settled")).toBe(NOW);
    // Approval rows are never snoozable; snoozed rows only offer Wake.
    expect(clock("tick-approval")).toBeUndefined();
    expect(clock("tick-snoozed")).toBeUndefined();
  });

  it("keeps the snooze menu clock off rows on servers without the capability", () => {
    const items = buildTickList([buildTickThreads().ready], BASE_MS, [], {
      snoozeEnvironmentIds: new Set<EnvironmentId>(),
    });
    const ready = items.find((item) => item.type === "v2-thread")!;
    expect(ready.type === "v2-thread" && ready.snoozePresetMinute).toBeUndefined();
  });

  it("blanks the precomputed time for rows that render a label instead", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const threads = buildTickThreads();
      const items = buildTickList(Object.values(threads), BASE_MS, []);
      const byKey = itemsByThreadKey(items);
      const label = (id: string) => {
        const item = byKey.get(`v2-thread:${environmentId}:${id}`)!;
        return item.type === "v2-thread" ? item.timeLabel : "<not a row>";
      };
      // Ready cards and settled slim rows draw their latest activity; the
      // status label outranks the time on the approval card, the wake
      // countdown on the snoozed row.
      expect(label("tick-ready")).toBe("5m");
      expect(label("tick-settled")).toBe("3d");
      expect(label("tick-approval")).toBe("");
      expect(label("tick-snoozed")).toBe("");
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
      const shellOrder = [threads.ready, threads.approval, threads.settled, threads.snoozed];
      const pendingTasks = [makePendingTask("tick-q")];
      const atStart = buildTickList(shellOrder, BASE_MS, pendingTasks);
      vi.setSystemTime(BASE_MS + MINUTE_MS);
      const atNextMinute = buildTickList(shellOrder, BASE_MS + MINUTE_MS, pendingTasks);

      expect(atStart.length).toBe(atNextMinute.length);
      const invalidated: string[] = [];
      for (let index = 0; index < atStart.length; index += 1) {
        if (!threadListV2ListItemsAreEqual(atStart[index]!, atNextMinute[index]!)) {
          invalidated.push(atStart[index]!.key);
        }
      }
      // The ready row's time and snooze menu move; the settled row's swipe
      // snooze menu moves. The approval card, the snoozed row ("2h" and Wake
      // only), the shelf headers and the queued row survive untouched.
      expect(invalidated).toEqual([
        `v2-thread:${environmentId}:tick-ready`,
        `v2-thread:${environmentId}:tick-settled`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps hour-granularity rows stable across a minute tick when they carry no snooze menu", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(BASE_MS);
      const staleReady = makeThread({
        id: ThreadId.make("tick-stale"),
        title: "tick stale",
        latestUserMessageAt: isoAt(BASE_MS - 3 * 60 * MINUTE_MS),
      });
      const noSnooze = { snoozeEnvironmentIds: new Set<EnvironmentId>() };
      const atStart = buildTickList([staleReady], BASE_MS, [], noSnooze);
      vi.setSystemTime(BASE_MS + MINUTE_MS);
      const atNextMinute = buildTickList([staleReady], BASE_MS + MINUTE_MS, [], noSnooze);
      expect(threadListV2ListItemsAreEqual(atStart[0]!, atNextMinute[0]!)).toBe(true);
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
      now: NOW,
    });
    const items = buildThreadListV2ListItems({
      items: layout.items,
      pendingTasks: [makePendingTask("div-q1"), makePendingTask("div-q2")],
      snoozeLabelNow: NOW,
    });
    const dividers = items.map((item) =>
      item.type === "v2-thread" || item.type === "v2-pending" ? item.showTrailingDivider : "n/a",
    );
    // thread | thread | queued | queued: consecutive threads keep their
    // hairlines, the row above the queued section rule loses its own, queued
    // rows divide each other, and the last row has nothing under it.
    expect(dividers).toEqual([true, false, true, false]);
  });
});

describe("buildThreadListV2ListItems row-state stamps", () => {
  const readyThread = buildTickThreads().ready;
  const settledThread = buildTickThreads().settled;
  const allEnvironments = new Set<EnvironmentId>([environmentId]);

  it("stamps queued outbox messages onto the matching row and notices removal", () => {
    const queued = buildTickList([readyThread, settledThread], BASE_MS, [], {
      queuedThreadKeys: new Set([`${environmentId}:tick-ready`]),
      snoozeEnvironmentIds: allEnvironments,
    });
    const plain = buildTickList([readyThread, settledThread], BASE_MS, [], {
      queuedThreadKeys: new Set<string>(),
      snoozeEnvironmentIds: allEnvironments,
    });
    const ready = (items: ThreadListV2ListItem[]) =>
      itemsByThreadKey(items).get(`v2-thread:${environmentId}:tick-ready`)!;
    const settled = (items: ThreadListV2ListItem[]) =>
      itemsByThreadKey(items).get(`v2-thread:${environmentId}:tick-settled`)!;
    const queuedRow = ready(queued);
    const plainRow = ready(plain);
    expect(queuedRow.type === "v2-thread" && queuedRow.hasQueuedMessages).toBe(true);
    expect(plainRow.type === "v2-thread" && plainRow.hasQueuedMessages).toBe(false);
    expect(threadListV2ListItemsAreEqual(ready(queued), ready(plain))).toBe(false);
    expect(threadListV2ListItemsAreEqual(settled(queued), settled(plain))).toBe(true);
  });

  it("notices pinned move-availability changes without a shell update", () => {
    const pinnedA = makeThread({
      id: ThreadId.make("pin-a"),
      title: "pin a",
      pinnedAt: "2026-06-01T12:00:00.000Z",
    });
    const pinnedB = makeThread({
      id: ThreadId.make("pin-b"),
      title: "pin b",
      pinnedAt: "2026-06-01T11:00:00.000Z",
    });
    const keyA = `${environmentId}:pin-a`;
    const keyB = `${environmentId}:pin-b`;
    const aFirst = buildTickList([pinnedA, pinnedB, readyThread], BASE_MS, [], {
      pinnedOrderKeys: [keyA, keyB],
    });
    const bFirst = buildTickList([pinnedA, pinnedB, readyThread], BASE_MS, [], {
      pinnedOrderKeys: [keyB, keyA],
    });
    const row = (items: ThreadListV2ListItem[], id: string) =>
      itemsByThreadKey(items).get(`v2-thread:${environmentId}:${id}`)!;
    const aTop = row(aFirst, "pin-a");
    const aBottom = row(bFirst, "pin-a");
    expect(aTop.type === "v2-thread" && [aTop.canMovePinnedUp, aTop.canMovePinnedDown]).toEqual([
      false,
      true,
    ]);
    expect(
      aBottom.type === "v2-thread" && [aBottom.canMovePinnedUp, aBottom.canMovePinnedDown],
    ).toEqual([true, false]);
    expect(threadListV2ListItemsAreEqual(aTop, aBottom)).toBe(false);
    // Unpinned rows never carry the moves, so the pinned order is inert there.
    expect(
      threadListV2ListItemsAreEqual(row(aFirst, "tick-ready"), row(bFirst, "tick-ready")),
    ).toBe(true);
  });

  it("stamps the shelf loading-disabled state so recycled headers refresh", () => {
    const shelf = (loading: boolean) =>
      buildTickList([settledThread], BASE_MS, [], {
        shelfPreferencesLoading: loading,
        snoozeEnvironmentIds: allEnvironments,
      }).find((item) => item.type === "v2-settled-shelf")!;
    expect(shelf(true).type === "v2-settled-shelf" && shelf(true).disabled).toBe(true);
    expect(shelf(false).type === "v2-settled-shelf" && shelf(false).disabled).toBe(false);
    expect(threadListV2ListItemsAreEqual(shelf(true), shelf(false))).toBe(false);
  });
});
