import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { markMateDeleting, settleDeletingMates } from "./deletingMates";
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
  /** The births this browser holds. */
  births: [] as Array<unknown>,
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
vi.mock("./zeropsBirths", () => ({
  useZeropsBirths: () => ({ births: app.births, waits: new Map(), outstanding: null }),
}));
vi.mock("../hooks/useHandleNewThread", () => ({
  useNewThreadHandler:
    () =>
    async (...args: ReadonlyArray<unknown>) => {
      app.newThreadCalls(...args);
      return app.newThread;
    },
}));

const CANDIDATE = {
  key: "fen:zcp",
  project: { id: "project-fen", name: "Acme Docs - Fen", status: "ACTIVE", tagList: [] },
  group: "connected",
} as unknown as ZeropsCandidate;

/** Opens Fen as the left menu's item does, and hands back what was told of the conversation. */
async function openFen(
  candidate: ZeropsCandidate = CANDIDATE,
): Promise<ReadonlyArray<ScopedThreadRef>> {
  const told: Array<ScopedThreadRef> = [];
  const opens: Array<ReturnType<typeof useOpenMate>> = [];
  function Harness() {
    opens.push(useOpenMate());
    return null;
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(h(Harness));
  });
  await act(async () => {
    opens.at(-1)?.(candidate, (conversation) => {
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
  app.births = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  settleDeletingMates(new Set());
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

  it.each([
    {
      case: "this tab deleted it, the listing not there yet",
      candidate: CANDIDATE,
      asked: true,
    },
    {
      case: "the platform deleting it",
      candidate: {
        ...CANDIDATE,
        project: { ...CANDIDATE.project, status: "DELETING" },
      } as ZeropsCandidate,
      asked: false,
    },
  ])("opens nothing of a Mate on its way off Zerops: $case", async ({ candidate, asked }) => {
    if (asked) markMateDeleting(candidate.project.id);
    app.threads = [shell("thread-main")];
    expect(await openFen(candidate)).toEqual([]);
    expect(app.navigate).not.toHaveBeenCalled();
    expect(app.newThreadCalls).not.toHaveBeenCalled();
  });
});

// The owner, 2026-09-29: a new Mate's row "looks like its ready to be opened, but it's not" — and
// pressed, did nothing. A Mate still in its first minutes opens its own view, where it comes up.
describe("useOpenMate — a Mate still coming up", () => {
  it.each([
    {
      case: "its birth held here",
      candidate: { ...CANDIDATE, group: "ready" },
      births: [{ projectId: "project-fen", step: "harden", overdue: false, container: true }],
    },
    {
      case: "its project on the way up",
      candidate: {
        ...CANDIDATE,
        group: "provisioning",
        service: { id: "zcp", name: "zcp", status: "CREATING" },
      },
      births: [],
    },
  ])("opens its own view: $case", async ({ candidate, births }) => {
    app.births = births;
    app.threads = [shell("thread-main")];
    expect(await openFen(candidate as unknown as ZeropsCandidate)).toEqual([]);
    expect(app.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/mate/$projectId",
      params: { projectId: "project-fen" },
    });
  });
});
