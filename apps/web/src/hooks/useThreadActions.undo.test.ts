import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { ZEROPS_RELEASE_QUESTION, ZEROPS_RELEASE_REQUEST } from "@t3tools/client-runtime/zerops";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useThreadActions } from "./useThreadActions";
import { projectMateLimit } from "@t3tools/client-runtime/data";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { threadEnvironment } from "../state/threads";
import { toastManager } from "../components/ui/toast";

const commands = vi.hoisted(() => ({
  archive: vi.fn(),
  unarchive: vi.fn(),
  startTurn: vi.fn(),
}));
const router = vi.hoisted(() => ({
  navigate: vi.fn(async () => {}),
  state: { matches: [{ params: {} as Record<string, string> }] },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useMemo: (create: () => unknown) => create(),
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));
vi.mock("./useSettings", () => ({ useClientSettings: () => false }));
vi.mock("./useHandleNewThread", () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock("../composerDraftStore", () => ({ useComposerDraftStore: () => vi.fn() }));
vi.mock("../terminalUiStateStore", () => ({ useTerminalUiStateStore: () => vi.fn() }));
vi.mock("../uiStateStore", () => ({ useUiStateStore: () => vi.fn() }));
vi.mock("../lib/archivedThreadsState", () => ({ refreshArchivedThreadsForEnvironment: vi.fn() }));
const threadShell = vi.hoisted(() => ({
  id: "thread",
  title: "Thread",
  projectId: "project",
  environmentId: "undo-env",
  session: null as OrchestrationThreadShell["session"],
  usagePause: null as OrchestrationThreadShell["usagePause"],
  lease: null as OrchestrationThreadShell["lease"],
  latestTurn: null as OrchestrationThreadShell["latestTurn"],
  modelSelection: {
    instanceId: "codex",
    model: "gpt-5.4",
  } as OrchestrationThreadShell["modelSelection"],
  runtimeMode: "full-access" as OrchestrationThreadShell["runtimeMode"],
  interactionMode: "default" as OrchestrationThreadShell["interactionMode"],
  archivedAt: null as string | null,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  readThreadShell: () => threadShell,
}));
vi.mock("../zerops/accountEnvironments", () => ({
  useMateCommand: (command: unknown) => {
    switch (command) {
      case threadEnvironment.archive:
        return commands.archive;
      case threadEnvironment.unarchive:
        return commands.unarchive;
      case threadEnvironment.startTurn:
        return commands.startTurn;
      default:
        return vi.fn();
    }
  },
}));

const target = {
  environmentId: EnvironmentId.make("undo-env"),
  threadId: ThreadId.make("thread"),
};
const event = {} as Parameters<NonNullable<React.ComponentProps<"button">["onClick"]>>[0];

function undoOf(
  add: { mock: { calls: Array<[Parameters<typeof toastManager.add>[0]]> } },
  index: number,
) {
  const onClick = add.mock.calls[index]?.[0].actionProps?.onClick;
  expect(onClick).toBeTypeOf("function");
  return () => onClick?.(event);
}

beforeEach(() => {
  for (const command of Object.values(commands)) {
    command.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  }
  router.navigate.mockClear();
  router.state.matches[0]!.params = {};
  threadShell.session = null;
  threadShell.usagePause = null;
  threadShell.lease = null;
});
afterEach(() => vi.restoreAllMocks());

describe("archive Undo", () => {
  it.each([true, false])(
    "a running SDK only blocks archiving while its turn is admitted (%s)",
    async (refused) => {
      vi.spyOn(toastManager, "add").mockReturnValue("toast");
      threadShell.session = {
        threadId: target.threadId,
        status: "running",
        activeTurnId: TurnId.make("turn"),
        providerName: "claudeAgent",
        runtimeMode: "full-access",
        lastError: refused ? "You've hit your weekly limit" : null,
        updatedAt: "2026-10-08T10:00:00Z",
      };
      vi.spyOn(appAtomRegistry, "get").mockReturnValue(
        projectMateLimit({ ...threadShell, latestTurn: null }, Date.parse("2026-10-08T10:00:00Z")),
      );
      const result = await useThreadActions().archiveThread(target);
      expect(result._tag).toBe(refused ? "Success" : "Failure");
      expect(commands.archive).toHaveBeenCalledTimes(refused ? 1 : 0);
    },
  );
  it("unarchives and returns to the thread when archiving left it", async () => {
    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    vi.spyOn(toastManager, "close").mockImplementation(() => {});
    router.state.matches[0]!.params = {
      environmentId: target.environmentId,
      threadId: target.threadId,
    };
    const actions = useThreadActions();
    await actions.archiveThread(target);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ title: "Thread archived" }));
    await undoOf(add, 0)();
    expect(commands.unarchive).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.threadId },
      }),
    );
  });

  it("stays put when the archived thread was not open", async () => {
    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    vi.spyOn(toastManager, "close").mockImplementation(() => {});
    const actions = useThreadActions();
    await actions.archiveThread(target);
    await undoOf(add, 0)();
    expect(commands.unarchive).toHaveBeenCalledOnce();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("shows no Undo when the archive failed", async () => {
    commands.archive.mockResolvedValue({ _tag: "Failure", cause: new Error("nope") });
    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    await useThreadActions().archiveThread(target);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("archiving a conversation bound to a lease", () => {
  const LEASE = { alias: "webpool-3", pool: "webpool", branch: "feat-x" } as NonNullable<
    OrchestrationThreadShell["lease"]
  >;
  type Toast = Parameters<typeof toastManager.add>[0];
  const releaseAsk = (add: { mock: { calls: Array<[Toast]> } }) =>
    add.mock.calls
      .map(([toast]) => toast)
      .find((toast) => toast.title === ZEROPS_RELEASE_QUESTION("webpool-3"));

  beforeEach(() => {
    threadShell.lease = LEASE;
  });

  it("archives at once, then asks whether to release the workspace, and sends nothing unasked", async () => {
    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    const result = await useThreadActions().archiveThread(target);
    expect(result._tag).toBe("Success");
    expect(commands.archive).toHaveBeenCalledOnce();
    expect(add, "the archive's own Undo still comes first").toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: "Thread archived" }),
    );
    const ask = releaseAsk(add);
    expect(ask?.actionProps?.children).toBe("Release");
    expect(ask?.data?.secondaryActionProps?.children).toBe("Not now");
    expect(ask?.timeout, "no timer answers it or takes it away").toBe(0);
    expect(commands.startTurn).not.toHaveBeenCalled();
    expect(commands.unarchive).not.toHaveBeenCalled();
  });

  it("asks only of a conversation bound to a lease, and only once it is archived", async () => {
    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    threadShell.lease = null;
    await useThreadActions().archiveThread(target);
    expect(releaseAsk(add), "bound to no lease").toBeUndefined();
    threadShell.lease = LEASE;
    commands.archive.mockResolvedValueOnce({ _tag: "Failure", cause: new Error("nope") });
    await useThreadActions().archiveThread(target);
    expect(releaseAsk(add), "the archive failed").toBeUndefined();
    await useThreadActions().archiveThread(target);
    expect(releaseAsk(add), "archived").toBeDefined();
  });

  it("Release brings the conversation back and sends its agent one visible request to release the lease", async () => {
    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    vi.spyOn(toastManager, "close").mockImplementation(() => {});
    await useThreadActions().archiveThread(target);
    await releaseAsk(add)?.actionProps?.onClick?.(event);
    expect(commands.unarchive).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    expect(commands.startTurn).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: expect.objectContaining({
        threadId: target.threadId,
        message: expect.objectContaining({
          role: "user",
          text: ZEROPS_RELEASE_REQUEST("webpool-3"),
          attachments: [],
        }),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        fromPanel: true,
      }),
    });
    expect(
      commands.unarchive.mock.invocationCallOrder[0],
      "an archived conversation takes no message, so it comes back first",
    ).toBeLessThan(commands.startTurn.mock.invocationCallOrder[0] ?? 0);
    expect(router.navigate, "the person sees the request and its answer").toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.threadId },
      }),
    );
  });

  it("Not now sends nothing and keeps the conversation archived", async () => {
    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    const close = vi.spyOn(toastManager, "close").mockImplementation(() => {});
    await useThreadActions().archiveThread(target);
    releaseAsk(add)?.data?.secondaryActionProps?.onClick?.(event);
    expect(close).toHaveBeenCalled();
    expect(commands.startTurn).not.toHaveBeenCalled();
    expect(commands.unarchive).not.toHaveBeenCalled();
  });
});
