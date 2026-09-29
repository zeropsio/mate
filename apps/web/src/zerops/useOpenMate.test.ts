import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useOpenMate } from "./useOpenMate";

const ENVIRONMENT = EnvironmentId.make("env-fen");

/** A conversation as the Mate's environment lists it. */
const shell = (id: string) => ({
  id: ThreadId.make(id),
  environmentId: ENVIRONMENT,
  archivedAt: null,
  pinnedAt: null,
  latestUserMessageAt: null,
  updatedAt: "2026-09-29T09:00:00.000Z",
  createdAt: "2026-09-29T08:00:00.000Z",
});

/** What the app knows while a Mate is opened: its conversations, its project, a new chat's answer. */
const app = vi.hoisted(() => ({
  threads: [] as Array<unknown>,
  /** The conversations as they stand when a new chat's answer comes back. */
  threadsLater: [] as Array<unknown>,
  reachable: true,
  newThread: null as { readonly draftId: string; readonly threadId: string } | null,
  /** What happened, in order: the route changing, and the caller being told. */
  log: [] as Array<string>,
  navigate: vi.fn(async () => {
    app.log.push("navigate");
  }),
  newThreadCalls: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: app.navigate }),
}));
vi.mock("../routes/-environmentTargets", () => ({
  useEnvironmentLinks: () => ({ linkTarget: () => (app.reachable ? ENVIRONMENT : undefined) }),
}));
vi.mock("../state/entities", () => ({
  useThreadShells: () => app.threads,
  readThreadShells: () => app.threadsLater,
  useProjects: () => [{ id: ProjectId.make("project-fen"), environmentId: ENVIRONMENT }],
}));
vi.mock("../hooks/useHandleNewThread", () => ({
  useNewThreadHandler:
    () =>
    async (...args: ReadonlyArray<unknown>) => {
      app.newThreadCalls(...args);
      return app.newThread;
    },
}));

const CANDIDATE = { key: "fen:zcp" } as unknown as ZeropsCandidate;

/** Opens Fen as the left menu's item does, and hands back what was told of the conversation. */
async function openFen(): Promise<ReadonlyArray<ScopedThreadRef>> {
  const told: Array<ScopedThreadRef> = [];
  let open: ReturnType<typeof useOpenMate> | undefined;
  function Harness() {
    open = useOpenMate();
    return null;
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(h(Harness));
  });
  await act(async () => {
    open?.(CANDIDATE, (conversation) => {
      app.log.push("told");
      told.push(conversation);
    });
  });
  act(() => {
    tree?.unmount();
  });
  return told;
}

beforeEach(() => {
  app.threads = [];
  app.threadsLater = [];
  app.reachable = true;
  app.newThread = null;
  app.log = [];
  app.navigate.mockClear();
  app.newThreadCalls.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOpenMate — what it tells the caller of the conversation it opened", () => {
  it("tells its main chat before the route changes, so the conversation paints with it", async () => {
    app.threads = [shell("thread-main")];
    const told = await openFen();
    expect(told).toEqual([{ environmentId: ENVIRONMENT, threadId: "thread-main" }]);
    expect(app.log).toEqual(["told", "navigate"]);
    expect(app.newThreadCalls).not.toHaveBeenCalled();
  });

  it("tells the chat a Mate with none starts", async () => {
    app.newThread = { draftId: "draft-1", threadId: "thread-new" };
    expect(await openFen()).toEqual([{ environmentId: ENVIRONMENT, threadId: "thread-new" }]);
  });

  it("tells the conversation that appeared meanwhile, which a new chat opens instead", async () => {
    app.newThread = null;
    app.threadsLater = [shell("thread-arrived")];
    expect(await openFen()).toEqual([{ environmentId: ENVIRONMENT, threadId: "thread-arrived" }]);
  });

  it("tells nothing where the projects screen takes over", async () => {
    app.reachable = false;
    expect(await openFen()).toEqual([]);
    expect(app.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/zerops" });
  });
});
