import type { ClientSettings } from "@t3tools/contracts/settings";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  mode: "off" as ClientSettings["notificationMode"],
  inApp: true,
  active: { environmentId: "env-1", threadId: "other-thread" },
  focused: true,
  visible: "visible",
  live: true,
  completedAt: null as string | null,
  archivedAt: null as string | null,
  crew: undefined as { crew: string; crewmate: string; stint: number } | undefined,
  input: false,
  approval: false,
  sessionError: false,
  turnError: false,
  muted: [] as string[],
  title: "Fix the login form",
  /** Whether the Mate is in HQ's view at all. */
  mates: true,
  /** Chats beside `thread-1`, as its Mate digests them. */
  chats: [] as Array<Record<string, unknown>>,
  add: vi.fn(
    (_toast: { title: string; description: string; actionProps: { onClick: () => void } }) =>
      "toast-1",
  ),
  close: vi.fn(),
  navigate: vi.fn(),
  sound: vi.fn(),
  notification: vi.fn(function (_title: string, options: NotificationOptions) {
    return Object.assign(new EventTarget(), { tag: options.tag, close: vi.fn() });
  }),
}));

/** The one Mate HQ's view holds, `thread-1` its chat as its Mate digests it from `state`. */
function mateView() {
  const failed = state.sessionError || state.turnError;
  const kind = state.approval
    ? "approval"
    : state.input
      ? "input"
      : failed
        ? "failed"
        : state.completedAt
          ? "idle"
          : "working";
  // An archived chat and a crewmate's are never in the Mate's digest of its chats.
  const listed = state.archivedAt === null && state.crew === undefined;
  return {
    presence: { online: true, since: "2026-09-13T08:00:00.000Z", overview: "live" },
    identity: { environmentId: "env-1", serverVersion: "0.11.90", update: null },
    main: null,
    threads: {
      list: [
        ...(listed
          ? [
              {
                id: "thread-1",
                title: state.title,
                kind,
                turnId: "turn-1",
                turnState: state.completedAt ? "completed" : failed ? "error" : "running",
                completedAt: state.completedAt,
              },
            ]
          : []),
        ...state.chats,
      ],
      omitted: 0,
    },
    logins: {},
    crew:
      state.crew === undefined
        ? null
        : {
            crewmates: [
              {
                handle: state.crew.crewmate,
                displayName: "Backend",
                tint: "sky",
                lead: false,
                threadId: "thread-1",
                threadKind: kind,
                loginKey: "claude-code",
              },
            ],
            attention: [],
            readyTasks: [],
            personLands: true,
          },
  };
}

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () =>
    state.mates
      ? {
          organizationId: "org-1",
          current: state.live,
          mates: new Map([["project-1", mateView()]]),
        }
      : { organizationId: "org-1", current: state.live, mates: new Map() },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useParams: () => state.active,
}));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (
    select: (
      settings: Pick<ClientSettings, "notificationMode" | "inAppNotificationsEnabled">,
    ) => unknown,
  ) => select({ notificationMode: state.mode, inAppNotificationsEnabled: state.inApp }),
  getClientSettings: () => ({ notificationMode: state.mode }),
}));
vi.mock("../state/zerops", () => ({ hqMatesAtom: "hq-mates" }));
// No Mate here publishes its attention: each rings off HQ's overview of it.
vi.mock("../zerops/ZeropsAccountData", () => ({
  useAccountOrgId: () => null,
  useProjection: () => ({}),
}));
vi.mock("../threadNotifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../threadNotifications")>()),
  playNotificationSound: state.sound,
  setNotificationBadge: vi.fn(),
}));
vi.mock("../zerops/mutedMates", () => ({
  useMutedMates: () => ({ muted: state.muted, toggle: vi.fn() }),
}));
vi.mock("./ui/toast", () => ({
  toastManager: { add: state.add, close: state.close },
}));

import { ThreadNotificationCoordinator } from "./ThreadNotificationCoordinator";

let renderer: ReactTestRenderer | undefined;

async function render() {
  await act(() => {
    if (renderer) renderer.update(<ThreadNotificationCoordinator />);
    else renderer = create(<ThreadNotificationCoordinator />);
  });
}

async function complete() {
  state.completedAt = "2026-09-13T10:00:00.000Z";
  await render();
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    mode: "off",
    inApp: true,
    active: { environmentId: "env-1", threadId: "other-thread" },
    focused: true,
    visible: "visible",
    live: true,
    completedAt: null,
    archivedAt: null,
    crew: undefined,
    input: false,
    approval: false,
    sessionError: false,
    turnError: false,
    muted: [],
    title: "Fix the login form",
    mates: true,
    chats: [],
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", {
    get visibilityState() {
      return state.visible;
    },
    hasFocus: () => state.focused,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("Notification", Object.assign(state.notification, { permission: "granted" }));
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("thread notifications", () => {
  // HQ's overview of a Mate is what rings: no socket to it, no shell of it.
  it("rings for a thread of a Mate it holds no socket to", async () => {
    await render();
    state.approval = true;
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Approval needed", description: "Fix the login form" }),
    );
  });

  it("takes a snapshot as the baseline", async () => {
    state.approval = true;
    await render();
    await render();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("rings for a chat that appears after the baseline and stops on an approval", async () => {
    await render();
    state.chats = [
      {
        id: "thread-2",
        title: "Add a cart",
        kind: "approval",
        turnId: "turn-1",
        turnState: "running",
        completedAt: null,
      },
    ];
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Approval needed", description: "Add a cart" }),
    );
  });

  it("closes a notification when its Mate leaves HQ's view", async () => {
    state.mode = "notifications";
    state.focused = false;
    await render();
    state.input = true;
    await render();
    const [notification] = state.notification.mock.results.map((result) => result.value);
    expect(notification?.close).not.toHaveBeenCalled();
    state.mates = false;
    await render();
    expect(notification?.close).toHaveBeenCalled();
  });

  it("rings nothing for a Mate its viewer muted: no toast, no sound, no desktop alert", async () => {
    state.mode = "notifications-and-sound";
    state.muted = ["env-1"];
    await render();
    await complete();
    state.input = true;
    await render();
    state.focused = false;
    state.approval = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.sound).not.toHaveBeenCalled();
    expect(state.notification).not.toHaveBeenCalled();
  });

  it("rings again once the Mate is unmuted, for what happens after — never for what it missed", async () => {
    state.muted = ["env-1"];
    await render();
    await complete();
    state.muted = [];
    await render();
    expect(state.add).not.toHaveBeenCalled();
    state.input = true;
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
  });

  it("alerts once with system alerts off and opens the completed thread", async () => {
    await render();
    await complete();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    const toast = state.add.mock.calls[0]?.[0];
    expect(toast?.title).toBe("Thread completed");
    expect(toast?.description).toBe("Fix the login form");
    toast?.actionProps.onClick();
    expect(state.close).toHaveBeenCalledWith("toast-1");
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-1", threadId: "thread-1" },
    });
    expect(state.notification).not.toHaveBeenCalled();
  });

  it.each(["active", "blurred", "hidden", "archived", "disabled"])(
    "does not show a completion toast for %s threads",
    async (condition) => {
      await render();
      if (condition === "active") state.active.threadId = "thread-1";
      if (condition === "blurred") state.focused = false;
      if (condition === "hidden") state.visible = "hidden";
      if (condition === "archived") state.archivedAt = "2026-09-13T09:00:00.000Z";
      if (condition === "disabled") state.inApp = false;
      await complete();
      expect(state.add).not.toHaveBeenCalled();
    },
  );

  // A crewmate's chat speaks through the crew line: no toast, sound or system popup.
  it("never rings for a crewmate's thread", async () => {
    state.mode = "notifications-and-sound";
    state.crew = { crew: "shop", crewmate: "backend", stint: 1 };
    await render();
    state.input = true;
    await render();
    state.input = false;
    state.focused = false;
    await complete();
    await render();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.sound).not.toHaveBeenCalled();
    expect(state.notification).not.toHaveBeenCalled();
  });

  it.each([
    ["input", "Input needed"],
    ["approval", "Approval needed"],
    ["sessionError", "Thread failed"],
    ["turnError", "Thread failed"],
  ] as const)("uses the same %s event for in-app and desktop alerts", async (event, title) => {
    state.mode = "notifications-and-sound";
    await render();
    state[event] = true;
    await render();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.add).toHaveBeenLastCalledWith(expect.objectContaining({ title }));
    expect(state.sound).toHaveBeenCalledWith("input", expect.any(Function));
    expect(state.notification).not.toHaveBeenCalled();

    state[event] = false;
    await render();
    state.focused = false;
    state[event] = true;
    await render();
    await render();
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.notification).toHaveBeenCalledTimes(1);
    expect(state.notification).toHaveBeenCalledWith(title, {
      body: "Fix the login form",
      tag: "env-1:thread-1",
      silent: true,
    });
  });

  it("never quotes a credential the conversation's title carries, in a toast or on the desktop", async () => {
    state.title = "log in as admin, password=hunter2026";
    state.mode = "notifications-and-sound";
    await render();
    await complete();
    await render();
    expect(state.add.mock.calls[0]?.[0].description).toBe("log in as admin, password=••••••");
    state.focused = false;
    state.input = true;
    await render();
    expect(state.notification.mock.calls[0]?.[1].body).toBe("log in as admin, password=••••••");
  });

  it("keeps background desktop alerts when in-app notifications are disabled", async () => {
    state.focused = false;
    state.inApp = false;
    state.mode = "notifications";
    await render();
    await complete();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.notification).toHaveBeenCalledTimes(1);
    state.inApp = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("does not replay a completion when opting in from all alerts off", async () => {
    state.inApp = false;
    await render();
    await complete();
    state.inApp = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("compares the environment as well as the thread", async () => {
    state.active = { environmentId: "env-2", threadId: "thread-1" };
    await render();
    await complete();
    expect(state.add).toHaveBeenCalledTimes(1);
  });

  it("does not replay completed threads on first load or reconnect", async () => {
    await complete();
    state.live = false;
    await render();
    state.live = true;
    await render();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("keeps sound but replaces the system popup when showing a toast", async () => {
    state.mode = "notifications-and-sound";
    await render();
    await complete();
    expect(state.sound).toHaveBeenCalledWith("completion", expect.any(Function));
    expect(state.add).toHaveBeenCalledTimes(1);
    expect(state.notification).not.toHaveBeenCalled();
  });

  it("keeps system alerts when the app is in the background", async () => {
    state.mode = "notifications";
    state.focused = false;
    await render();
    await complete();
    expect(state.add).not.toHaveBeenCalled();
    expect(state.notification).toHaveBeenCalledWith("Thread completed", {
      body: "Fix the login form",
      tag: "env-1:thread-1",
      silent: true,
    });
  });
});
