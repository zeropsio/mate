import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../../zerops/__fixtures__/testDom";
import { useComposerMenuHighlight } from "./composerMenuHighlight";

/** One external store value, read the way the composer reads its stores. */
function makeStore() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    write: (next: number) => {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribed: () => listeners.size > 0,
  };
}

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  return document;
}

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useComposerMenuHighlight", () => {
  // A connection coming back after a lapse lands its replays as a run of
  // store writes in one task, each committed synchronously. The composer
  // rebuilds its menu items on every render, so the sync runs after every
  // one of those commits; an update it schedules there outlives the commit,
  // and React counts each such commit as nested (limit 50).
  it.each([
    { menu: "closed", menuOpen: false, searchKey: null, highlighted: null },
    { menu: "open", menuOpen: true, searchKey: "slash-command:", highlighted: "slash:model" },
  ])(
    "survives a burst of synchronous store commits with the menu $menu and its items rebuilt on every render",
    async ({ menuOpen, searchKey, highlighted }) => {
      const document = installTestDom();
      const { createRoot } = await import("react-dom/client");
      const store = makeStore();
      const uncaught: unknown[] = [];
      let rendered = { written: -1, highlighted: undefined as string | null | undefined };

      function Composer() {
        const written = useSyncExternalStore(store.subscribe, store.read);
        const items = menuOpen ? [{ id: "slash:model" }, { id: "slash:plan" }] : [];
        const { highlightedItemId } = useComposerMenuHighlight({ menuOpen, items, searchKey });
        rendered = { written, highlighted: highlightedItemId };
        return <span>{written}</span>;
      }

      const root = createRoot(document.createElement("div") as unknown as Element, {
        onUncaughtError: (error) => uncaught.push(error),
      });
      try {
        root.render(<Composer />);
        // The store is subscribed once the mount's passive effects ran.
        while (!store.subscribed()) await nextMacrotask();
        for (let write = 1; write <= 80; write += 1) {
          store.write(write);
          await Promise.resolve();
        }
        await nextMacrotask();
        expect(uncaught).toEqual([]);
        expect(rendered).toEqual({ written: 80, highlighted });
      } finally {
        root.unmount();
        await nextMacrotask();
      }
    },
  );
});
