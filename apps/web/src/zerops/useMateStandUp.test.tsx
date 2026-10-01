import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act, createElement, Fragment } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "../lib/terminalContext";
import { MATE_STAND_UP_MESSAGE } from "./mateStandUp";

const ENVIRONMENT = EnvironmentId.make("environment-fen");
const MAIN = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-main"));
const SECOND = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-second"));
const ADA = "u-ada";

const world = vi.hoisted(() => ({
  viewer: "u-ada" as string | undefined,
  standUp: { by: "u-ada" } as { readonly by: string } | undefined,
  threads: [] as ReadonlyArray<Record<string, unknown>>,
  updateProjectTags: vi.fn(),
}));

vi.mock("./useZeropsMates", () => ({
  useZeropsMateDirectory: () =>
    new Map([
      [
        "environment-fen",
        {
          name: "Fen",
          tint: "olive",
          project: "Acme Docs",
          projectUrl: "https://app.zerops.io/project/p1",
          connected: true,
          ...(world.standUp === undefined ? {} : { standUp: world.standUp }),
        },
      ],
    ]),
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () =>
    world.viewer === undefined ? null : { user: { id: world.viewer } },
}));
vi.mock("../state/entities", () => ({
  useThreadShells: () => world.threads,
}));
vi.mock("./useZeropsAgentSigner", () => ({
  useZeropsEnvironmentProject: () => ({ projectId: "project-fen", orgId: "org-acme" }),
}));
vi.mock("./zeropsDataContext", async () => {
  const { createContext } = await import("react");
  return {
    ZeropsDataContext: createContext({
      runtime: { commands: { updateProjectTags: world.updateProjectTags } },
      projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    }),
    runZeropsCommand: (command: Promise<unknown>) => command,
  };
});

function shell(ref: ScopedThreadRef, createdAt: string) {
  return {
    id: ref.threadId,
    environmentId: ref.environmentId,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
    latestUserMessageAt: null,
  };
}

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  return document;
}

interface ViewInput {
  readonly threadRef: ScopedThreadRef | null;
  readonly messageCount: number;
  readonly canSend: boolean;
  readonly sendBusy: boolean;
}

const OPEN: ViewInput = { threadRef: MAIN, messageCount: 0, canSend: true, sendBusy: false };

/** The person's conversation views over one session: `views` of them at once. */
async function openViews(views = 1) {
  const document = installTestDom();
  const { createRoot } = await import("react-dom/client");
  const { useMateStandUp, useMateStandUpAttempt, resetMateStandUpSession, retryMateStandUp } =
    await import("./useMateStandUp");
  const { useComposerDraftStore } = await import("../composerDraftStore");
  resetMateStandUpSession();
  const asked: Array<{ readonly thread: string; readonly prompt: string; readonly ids: unknown }> =
    [];
  useComposerDraftStore.setState({
    sendRequestsByThreadKey: {},
    requestSend: (threadRef, prompt, ids) => {
      asked.push({
        thread: typeof threadRef === "string" ? threadRef : scopedThreadKey(threadRef),
        prompt,
        ids,
      });
    },
  });
  /** What the empty conversation read, draw by draw. */
  const attempts: Array<string> = [];
  function View(props: ViewInput) {
    useMateStandUp({ environmentId: ENVIRONMENT, ...props });
    return null;
  }
  function Empty() {
    attempts.push(useMateStandUpAttempt(ENVIRONMENT));
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  const show = (input: Partial<ViewInput> = {}) =>
    act(async () => {
      const props = { ...OPEN, ...input };
      root.render(
        createElement(
          Fragment,
          null,
          ...Array.from({ length: views }, (_, index) =>
            createElement(View, { key: index, ...props }),
          ),
          createElement(Empty),
        ),
      );
    });
  return {
    show,
    asked,
    attempt: () => attempts.at(-1),
    retry: () => act(async () => retryMateStandUp(ENVIRONMENT)),
    close: () => act(async () => root.unmount()),
  };
}

beforeEach(() => {
  world.viewer = ADA;
  world.standUp = { by: ADA };
  world.threads = [shell(MAIN, "2026-09-29T10:00:00.000Z")];
  world.updateProjectTags.mockReset();
  world.updateProjectTags.mockResolvedValue({ kind: "written" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const STAND_UP = {
  thread: scopedThreadKey(MAIN),
  prompt: "Stand up development of the project.",
  ids: { commandId: "mate-standup-thread-main-1", messageId: "mate-standup-thread-main-1" },
};

describe("useMateStandUp", () => {
  it("asks the composer once, with the conversation's ids, however often and wherever it renders", async () => {
    const views = await openViews(2);
    try {
      await views.show();
      await views.show();
      expect(views.asked).toEqual([STAND_UP]);
      expect(views.attempt()).toBe("sending");
    } finally {
      await views.close();
    }
  });

  it("waits for the sign-in, then sends", async () => {
    const views = await openViews();
    try {
      await views.show({ canSend: false });
      expect(views.asked).toEqual([]);
      await views.show({ canSend: true });
      expect(views.asked).toEqual([STAND_UP]);
    } finally {
      await views.close();
    }
  });

  it.each([
    { name: "a colleague looking", world: { viewer: "u-fen" }, input: {} },
    { name: "a Mate nobody asked it of", world: { standUp: undefined }, input: {} },
    { name: "who is looking not known yet", world: { viewer: undefined }, input: {} },
    {
      name: "a conversation not read live (cached, or loading)",
      world: {},
      input: { threadRef: null },
    },
    { name: "a conversation that holds a message", world: {}, input: { messageCount: 1 } },
    { name: "another send on its way", world: {}, input: { sendBusy: true } },
  ])("sends nothing for $name", async ({ world: facts, input }) => {
    Object.assign(world, facts);
    const views = await openViews();
    try {
      await views.show(input);
      expect(views.asked).toEqual([]);
    } finally {
      await views.close();
    }
  });

  it("sends nothing into another of the Mate's chats: the stand-up is the main one's", async () => {
    world.threads = [
      shell(MAIN, "2026-09-29T10:00:00.000Z"),
      shell(SECOND, "2026-09-29T09:00:00.000Z"),
    ];
    const views = await openViews();
    try {
      await views.show({ threadRef: SECOND });
      expect(views.asked).toEqual([]);
    } finally {
      await views.close();
    }
  });

  it("a send seen leaving that left the conversation empty did not go through; Try again sends the next attempt", async () => {
    const views = await openViews();
    try {
      await views.show();
      await views.show({ sendBusy: true });
      expect(views.attempt()).toBe("sending");
      await views.show({ sendBusy: false });
      expect(views.attempt()).toBe("failed");
      // Nothing goes again on its own.
      await views.show();
      expect(views.asked).toHaveLength(1);

      await views.retry();
      await views.show();
      expect(views.asked.at(-1)).toEqual({
        ...STAND_UP,
        ids: { commandId: "mate-standup-thread-main-2", messageId: "mate-standup-thread-main-2" },
      });
      expect(views.attempt()).toBe("sending");
    } finally {
      await views.close();
    }
  });

  // A live run (2026-10-01): the browser's ask was refused, its words went back into the
  // composer, and the Mate's own server sent the stand-up a few seconds later. The conversation
  // holds it: nothing "didn't go through", and the words left in the composer are not a draft.
  it("a failed ask gives way to the stand-up the conversation holds since, and leaves no draft", async () => {
    const views = await openViews();
    const { useComposerDraftStore } = await import("../composerDraftStore");
    try {
      await views.show();
      await views.show({ sendBusy: true });
      await views.show({ sendBusy: false });
      expect(views.attempt()).toBe("failed");
      // The refused send handed its words back to the composer, beside what the person had put
      // there meanwhile — a terminal's lines here; pictures and review notes alike.
      act(() => {
        const drafts = useComposerDraftStore.getState();
        drafts.setPrompt(MAIN, MATE_STAND_UP_MESSAGE);
        drafts.setTerminalContexts(MAIN, [
          {
            id: "context-1",
            threadId: ThreadId.make("thread-main"),
            createdAt: "2026-10-01T10:00:00.000Z",
            terminalId: "term-1",
            terminalLabel: "Terminal 1",
            lineStart: 1,
            lineEnd: 2,
            text: "npm run dev",
          },
        ]);
      });

      await views.show({ messageCount: 1 });

      expect(views.attempt()).not.toBe("failed");
      const draft = useComposerDraftStore.getState().getComposerDraft(MAIN);
      // The ask's words gone; the terminal lines' place stays where it stood.
      expect(draft?.prompt).toBe(INLINE_TERMINAL_CONTEXT_PLACEHOLDER);
      expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["context-1"]);
    } finally {
      await views.close();
    }
  });

  it("leaves words the person typed after a failed ask", async () => {
    const views = await openViews();
    const { useComposerDraftStore } = await import("../composerDraftStore");
    try {
      await views.show();
      await views.show({ sendBusy: true });
      await views.show({ sendBusy: false });
      act(() => useComposerDraftStore.getState().setPrompt(MAIN, "Also add a blog."));

      await views.show({ messageCount: 1 });

      expect(useComposerDraftStore.getState().getComposerDraft(MAIN)?.prompt).toBe(
        "Also add a blog.",
      );
    } finally {
      await views.close();
    }
  });

  it("a send nothing saw leave did not go through, once its time has passed", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-29T10:00:00.000Z") });
    const views = await openViews();
    try {
      await views.show();
      await act(async () => {
        vi.advanceTimersByTime(7_999);
      });
      expect(views.attempt()).toBe("sending");
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(views.attempt()).toBe("failed");
    } finally {
      await views.close();
    }
  });

  it("clears the ask once the conversation holds a message, once", async () => {
    const views = await openViews();
    try {
      await views.show();
      await views.show({ sendBusy: true });
      await views.show({ messageCount: 1 });
      await views.show({ messageCount: 2 });
      expect(world.updateProjectTags).toHaveBeenCalledTimes(1);
      expect(world.updateProjectTags).toHaveBeenCalledWith(
        { organizationId: "org-acme", projectId: "project-fen" },
        { kind: "stand-up-done" },
      );
    } finally {
      await views.close();
    }
  });

  it("clears an ask a reload finds answered, and sends nothing", async () => {
    const views = await openViews();
    try {
      await views.show({ messageCount: 1 });
      expect(views.asked).toEqual([]);
      expect(world.updateProjectTags).toHaveBeenCalledTimes(1);
    } finally {
      await views.close();
    }
  });

  it("leaves a colleague's ask to them", async () => {
    world.viewer = "u-fen";
    const views = await openViews();
    try {
      await views.show({ messageCount: 1 });
      expect(world.updateProjectTags).not.toHaveBeenCalled();
    } finally {
      await views.close();
    }
  });
});
