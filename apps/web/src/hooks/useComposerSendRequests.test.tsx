import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../zerops/__fixtures__/testDom";
import {
  composerAdmits,
  type ComposerAdmits,
  type ComposerSendResult,
} from "./useComposerSendRequests";

const ENVIRONMENT = EnvironmentId.make("environment-send-requests");
const MAIN = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-main"));
const OTHER = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-other"));
const IDS = {
  commandId: CommandId.make("mate-standup-thread-main-1"),
  messageId: MessageId.make("mate-standup-thread-main-1"),
};
const WORDS = "Stand up development of the project.";
const SENDS: ComposerAdmits = { kind: "sends" };
const SIGN_IN = "Eddy needs a Claude sign-in to continue.";

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A composer that records what it wrote, what it tried to send and what went, and which
 * conversation it shows. Its send answers from `answers`, in turn, and goes out once they run out.
 */
async function openComposer(
  options: { readonly strict?: boolean; readonly answers?: Array<ComposerSendResult> } = {},
) {
  const document = installTestDom();
  const { act, StrictMode } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useComposerSendRequests, sendOutcomeOf } = await import("./useComposerSendRequests");
  const { useComposerDraftStore } = await import("../composerDraftStore");
  useComposerDraftStore.setState({ sendRequestsByThreadKey: {} });
  const written: Array<string> = [];
  const sent: Array<{ readonly words: string | undefined; readonly ids: unknown }> = [];
  const tried: Array<unknown> = [];
  const answers = [...(options.answers ?? [])];

  function Composer({
    target,
    admits,
    ready,
  }: {
    readonly target: ScopedThreadRef | null;
    readonly admits: ComposerAdmits;
    readonly ready: boolean;
  }) {
    useComposerSendRequests({
      target,
      targetKey: target === null ? null : scopedThreadKey(target),
      admits,
      ready,
      write: (prompt) => written.push(prompt),
      send: async (ids) => {
        tried.push(ids);
        const answer = answers.shift() ?? { sent: true };
        if (answer !== "not-ready" && answer.sent) sent.push({ words: written.at(-1), ids });
        return answer;
      },
    });
    return null;
  }

  const root = createRoot(document.createElement("div") as unknown as Element);
  const show = (
    target: ScopedThreadRef | null,
    admits: ComposerAdmits = SENDS,
    { ready = true }: { readonly ready?: boolean } = {},
  ) =>
    act(async () => {
      root.render(
        options.strict ? (
          <StrictMode>
            <Composer target={target} admits={admits} ready={ready} />
          </StrictMode>
        ) : (
          <Composer target={target} admits={admits} ready={ready} />
        ),
      );
    });
  const ask = (target: ScopedThreadRef) =>
    act(async () => {
      useComposerDraftStore.getState().requestSend(target, WORDS, IDS);
    });
  const settle = () =>
    act(async () => {
      vi.advanceTimersByTime(10);
    });
  const pending = (target: ScopedThreadRef) =>
    useComposerDraftStore.getState().sendRequestsByThreadKey[scopedThreadKey(target)];
  const close = () => act(async () => root.unmount());
  return { show, ask, settle, pending, close, sent, tried, written, sendOutcomeOf };
}

describe("useComposerSendRequests", () => {
  it.each([
    { when: "filed while its conversation is open", strict: false, askFirst: false },
    { when: "filed before its conversation opens", strict: false, askFirst: true },
    { when: "filed under StrictMode's doubled effects", strict: true, askFirst: false },
  ])("sends a request $when, once, with its words and ids", async ({ strict, askFirst }) => {
    const composer = await openComposer({ strict });
    try {
      if (askFirst) await composer.ask(MAIN);
      await composer.show(MAIN);
      if (!askFirst) await composer.ask(MAIN);
      await composer.settle();
      // The take re-renders the view that took it; that re-render must not
      // cancel the send it scheduled.
      expect(composer.sent).toEqual([{ words: WORDS, ids: IDS }]);
      expect(composer.pending(MAIN)).toBeUndefined();
    } finally {
      await composer.close();
    }
  });

  it("leaves a request for another conversation waiting for it", async () => {
    const composer = await openComposer();
    try {
      await composer.show(OTHER);
      await composer.ask(MAIN);
      await composer.settle();
      expect(composer.sent).toEqual([]);
      expect(composer.pending(MAIN)).toEqual({ prompt: WORDS, ids: IDS });
    } finally {
      await composer.close();
    }
  });

  it("asks again for a conversation left before its request went", async () => {
    const composer = await openComposer();
    try {
      await composer.show(MAIN);
      await composer.ask(MAIN);
      // Taken, and the person is elsewhere before it goes: never into the
      // conversation now shown, and still asked of the one it named.
      await composer.show(OTHER);
      await composer.settle();
      expect(composer.sent).toEqual([]);
      expect(composer.pending(MAIN)).toEqual({ prompt: WORDS, ids: IDS });
    } finally {
      await composer.close();
    }
  });

  it("tells whoever asked that its words went out", async () => {
    const composer = await openComposer();
    try {
      const outcome = composer.sendOutcomeOf(IDS.messageId);
      await composer.show(MAIN);
      await composer.ask(MAIN);
      await composer.settle();
      await expect(outcome).resolves.toEqual({ sent: true });
    } finally {
      await composer.close();
    }
  });

  it("leaves the words in the composer where its agent takes no turn, and says why", async () => {
    const composer = await openComposer();
    try {
      const outcome = composer.sendOutcomeOf(IDS.messageId);
      await composer.show(MAIN, { kind: "holds", why: SIGN_IN });
      await composer.ask(MAIN);
      await composer.settle();
      expect(composer.sent).toEqual([]);
      expect(composer.written).toEqual([WORDS]);
      expect(composer.pending(MAIN)).toBeUndefined();
      await expect(outcome).resolves.toEqual({ sent: false, why: SIGN_IN });
    } finally {
      await composer.close();
    }
  });

  it("waits while the conversation still reads whether its agent takes a turn", async () => {
    const composer = await openComposer();
    try {
      await composer.show(MAIN, { kind: "reading" });
      await composer.ask(MAIN);
      await composer.settle();
      expect(composer.sent).toEqual([]);
      expect(composer.pending(MAIN)).toEqual({ prompt: WORDS, ids: IDS });
      await composer.show(MAIN);
      await composer.settle();
      expect(composer.sent).toEqual([{ words: WORDS, ids: IDS }]);
    } finally {
      await composer.close();
    }
  });

  it("a requested send waits while its conversation is still loading, then goes out once it can", async () => {
    const composer = await openComposer();
    try {
      const outcome = composer.sendOutcomeOf(IDS.messageId);
      let told = false;
      void outcome.then(() => (told = true));
      // Its agent takes a turn, but the conversation still loads, connects or mounts its composer.
      await composer.show(MAIN, SENDS, { ready: false });
      await composer.ask(MAIN);
      await composer.settle();
      expect(composer.tried).toEqual([]);
      expect(composer.pending(MAIN)).toEqual({ prompt: WORDS, ids: IDS });
      expect(told).toBe(false);
      await composer.show(MAIN);
      await composer.settle();
      expect(composer.sent).toEqual([{ words: WORDS, ids: IDS }]);
      await expect(outcome).resolves.toEqual({ sent: true });
    } finally {
      await composer.close();
    }
  });

  it("a requested send the composer declines is never told as sent", async () => {
    const declined = "It did not go out.";
    const composer = await openComposer({ answers: [{ sent: false, why: declined }] });
    try {
      const outcome = composer.sendOutcomeOf(IDS.messageId);
      await composer.show(MAIN);
      await composer.ask(MAIN);
      await composer.settle();
      expect(composer.sent).toEqual([]);
      expect(composer.written).toEqual([WORDS]);
      expect(composer.pending(MAIN)).toBeUndefined();
      await expect(outcome).resolves.toEqual({ sent: false, why: declined });
    } finally {
      await composer.close();
    }
  });

  it("a requested send its composer was not yet ready for waits for it once more, never in a loop", async () => {
    const composer = await openComposer({ answers: ["not-ready"] });
    try {
      const outcome = composer.sendOutcomeOf(IDS.messageId);
      let told = false;
      void outcome.then(() => (told = true));
      await composer.show(MAIN);
      await composer.ask(MAIN);
      await composer.settle();
      await composer.settle();
      expect(composer.tried).toEqual([IDS]);
      expect(composer.pending(MAIN)).toEqual({ prompt: WORDS, ids: IDS });
      expect(told).toBe(false);
      // Asked again once the conversation's readiness changes.
      await composer.show(MAIN, SENDS, { ready: false });
      await composer.show(MAIN);
      await composer.settle();
      expect(composer.sent).toEqual([{ words: WORDS, ids: IDS }]);
      await expect(outcome).resolves.toEqual({ sent: true });
    } finally {
      await composer.close();
    }
  });
});

describe("composerAdmits", () => {
  const READ_ALONG = "Eddy is Petr's Mate — you can read along.";
  it.each([
    { when: "its agent takes a turn", canSend: true, reason: null, readOnly: null, admits: SENDS },
    {
      when: "it waits for a sign-in",
      canSend: false,
      reason: SIGN_IN,
      readOnly: null,
      admits: { kind: "holds", why: SIGN_IN },
    },
    {
      when: "it is a colleague's Mate",
      canSend: false,
      reason: null,
      readOnly: READ_ALONG,
      admits: { kind: "holds", why: READ_ALONG },
    },
    {
      when: "it still reads, or a stand-up holds it",
      canSend: false,
      reason: null,
      readOnly: null,
      admits: { kind: "reading" },
    },
  ])("a request is $admits.kind where $when", ({ canSend, reason, readOnly, admits }) => {
    expect(composerAdmits({ canSend, sendBlockReason: reason }, readOnly)).toEqual(admits);
  });
});
