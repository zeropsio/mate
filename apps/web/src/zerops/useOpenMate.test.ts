import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { markMateDeleting, settleDeletingMates } from "./deletingMates";
import { takeMateConversation } from "./mateOpening";
import { useOpenMate, type OpenMate } from "./useOpenMate";

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
  /** The projects its environments' conversations list, once read. */
  projects: [] as Array<unknown>,
  /** The active organization's listing, as the jump box and a project's page look a Mate up in it. */
  listing: { state: "unread", waitingFor: null } as unknown,
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
  useProjects: () => app.projects,
}));
vi.mock("./useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: app.listing }),
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
  candidate: Parameters<OpenMate>[0] = CANDIDATE,
): Promise<ReadonlyArray<ScopedThreadRef>> {
  const told: Array<ScopedThreadRef> = [];
  const opens: Array<OpenMate> = [];
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
  app.projects = [{ id: ProjectId.make("project-fen"), environmentId: ENVIRONMENT }];
  app.listing = { state: "unread", waitingFor: null };
});
afterEach(() => {
  vi.unstubAllGlobals();
  settleDeletingMates(new Set());
  takeMateConversation("project-fen");
});

const FEN_VIEW = { to: "/mate/$projectId", params: { projectId: "project-fen" } } as const;

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
});

// The owner, 2026-09-30: "all of the sudden when I now try to open Quinn or Wren it just throws me
// at /zerops page". A Mate the person can see opens its own view whenever its conversation cannot be
// opened yet; the view connects it, says what it waits for, and hands over — telling the caller
// then, not before.
describe("useOpenMate — a Mate whose conversation cannot be opened yet", () => {
  it.each([
    {
      case: "its link not made in this tab, or being made again",
      reachable: false,
      projects: [{ id: "project-fen", environmentId: ENVIRONMENT }],
    },
    {
      case: "its environment registered, its conversations not read yet",
      reachable: true,
      projects: [],
    },
  ])("opens its own view, never the projects screen: $case", async ({ reachable, projects }) => {
    app.reachable = reachable;
    app.projects = projects;
    const told = await openFen();
    expect(app.navigate).toHaveBeenCalledExactlyOnceWith(FEN_VIEW);
    expect(app.newThreadCalls).not.toHaveBeenCalled();
    // Told once the view hands over, of the conversation it hands over to.
    expect(told).toEqual([]);
    takeMateConversation("project-fen")?.({
      environmentId: ENVIRONMENT,
      threadId: ThreadId.make("thread-main"),
    });
    expect(told).toEqual([{ environmentId: ENVIRONMENT, threadId: "thread-main" }]);
  });

  it("forgets what an earlier door asked of its view once a door opens its conversation at once", async () => {
    app.reachable = false;
    const earlier = vi.fn();
    const opens: Array<OpenMate> = [];
    function Harness() {
      opens.push(useOpenMate());
      return null;
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let tree: ReturnType<typeof create> | undefined;
    act(() => {
      tree = create(h(Harness));
    });
    await act(async () => opens.at(-1)?.(CANDIDATE, earlier));
    app.reachable = true;
    app.threads = [shell("thread-main")];
    act(() => tree?.update(h(Harness)));
    await act(async () => opens.at(-1)?.(CANDIDATE));
    act(() => tree?.unmount());

    expect(takeMateConversation("project-fen")).toBeUndefined();
    expect(earlier).not.toHaveBeenCalled();
  });

  it("opens a Mate named by its project that the listing does not hold yet in its own view", async () => {
    expect(await openFen({ projectId: "project-fen" })).toEqual([]);
    expect(app.navigate).toHaveBeenCalledExactlyOnceWith(FEN_VIEW);
  });

  it("opens a Mate named by its project that the listing holds as its row does", async () => {
    app.listing = {
      state: "known",
      value: [{ ...CANDIDATE, presence: "known" }],
      coverage: "complete",
      asOf: { ordinal: 1, atMs: 0 },
      freshness: { kind: "live" },
    };
    app.threads = [shell("thread-main")];
    expect(await openFen({ projectId: "project-fen" })).toEqual([
      { environmentId: ENVIRONMENT, threadId: "thread-main" },
    ]);
    expect(app.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: ENVIRONMENT, threadId: "thread-main" },
    });
  });

  it("opens nothing of a Mate on its way off Zerops, named by its project", async () => {
    markMateDeleting("project-fen");
    expect(await openFen({ projectId: "project-fen" })).toEqual([]);
    expect(app.navigate).not.toHaveBeenCalled();
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
