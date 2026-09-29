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

const ENVIRONMENT = EnvironmentId.make("environment-send-requests");
const MAIN = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-main"));
const OTHER = scopeThreadRef(ENVIRONMENT, ThreadId.make("thread-other"));
const IDS = {
  commandId: CommandId.make("mate-standup-thread-main-1"),
  messageId: MessageId.make("mate-standup-thread-main-1"),
};
const WORDS = "Stand up development of the project.";

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

/** A composer that records what it wrote and what it sent, and which conversation it shows. */
async function openComposer(options: { readonly strict?: boolean } = {}) {
  const document = installTestDom();
  const { act, StrictMode } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useComposerSendRequests } = await import("./useComposerSendRequests");
  const { useComposerDraftStore } = await import("../composerDraftStore");
  useComposerDraftStore.setState({ sendRequestsByThreadKey: {} });
  const written: Array<string> = [];
  const sent: Array<{ readonly words: string | undefined; readonly ids: unknown }> = [];

  function Composer({ target }: { readonly target: ScopedThreadRef | null }) {
    useComposerSendRequests({
      target,
      targetKey: target === null ? null : scopedThreadKey(target),
      write: (prompt) => written.push(prompt),
      send: (ids) => sent.push({ words: written.at(-1), ids }),
    });
    return null;
  }

  const root = createRoot(document.createElement("div") as unknown as Element);
  const show = (target: ScopedThreadRef | null) =>
    act(async () => {
      root.render(
        options.strict ? (
          <StrictMode>
            <Composer target={target} />
          </StrictMode>
        ) : (
          <Composer target={target} />
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
  return { show, ask, settle, pending, close, sent };
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
});
