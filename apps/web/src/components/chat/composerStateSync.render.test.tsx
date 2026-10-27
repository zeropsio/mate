import { act, useState, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../../zerops/__fixtures__/testDom";
import { useSyncStateOnChange } from "./composerStateSync";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSyncStateOnChange", () => {
  // The composer closes its stash menu and tasks drawer, clears its provider error and clamps
  // its cursor after a commit in which their inputs changed. A reconnect lands a run of store
  // writes in one task, each committed synchronously; an input that changes on each of them
  // runs the sync after every commit, and an update it schedules there outlives the commit,
  // so React counts each such commit as nested (limit 50).
  it.each([
    { state: "a closed menu", initial: false, target: () => false },
    { state: "a cleared error", initial: null, target: () => null },
    {
      state: "a cursor inside the prompt",
      initial: 3,
      target: (value: number) => Math.min(value, 5),
    },
  ])(
    "survives a burst of synchronous store commits that change its input, with $state already at its target",
    async ({ initial, target }) => {
      const document = installTestDom();
      const { createRoot } = await import("react-dom/client");
      const store = makeStore();
      const uncaught: unknown[] = [];
      let rendered = { written: -1, value: undefined as unknown };

      function Composer() {
        const written = useSyncExternalStore(store.subscribe, store.read);
        const [value, setValue] = useState<unknown>(initial);
        useSyncStateOnChange(value, setValue, (target as (value: unknown) => unknown)(value), [
          written,
        ]);
        rendered = { written, value };
        return <span>{written}</span>;
      }

      const root = createRoot(document.createElement("div") as unknown as Element, {
        onUncaughtError: (error) => uncaught.push(error),
      });
      try {
        root.render(<Composer />);
        // The store is subscribed once the mount's passive effects ran.
        await vi.waitFor(() => expect(store.subscribed()).toBe(true));
        for (let write = 1; write <= 80; write += 1) {
          store.write(write);
          await Promise.resolve();
        }
        await vi.waitFor(() => expect(rendered).toEqual({ written: 80, value: initial }));
        expect(uncaught).toEqual([]);
        expect(rendered).toEqual({ written: 80, value: initial });
      } finally {
        await act(async () => root.unmount());
      }
    },
  );

  it("moves the state to its target after a commit that changed an input", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const store = makeStore();
    let rendered: { readonly written: number; readonly open: boolean } | undefined;

    function Composer() {
      const written = useSyncExternalStore(store.subscribe, store.read);
      const [open, setOpen] = useState(true);
      // The menu closes once the store has been written twice.
      useSyncStateOnChange(open, setOpen, open && written < 2, [written]);
      rendered = { written, open };
      return <span>{written}</span>;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(<Composer />);
      await vi.waitFor(() => expect(store.subscribed()).toBe(true));
      store.write(1);
      await vi.waitFor(() => expect(rendered).toEqual({ written: 1, open: true }));
      store.write(2);
      await vi.waitFor(() => expect(rendered).toEqual({ written: 2, open: false }));
    } finally {
      await act(async () => root.unmount());
    }
  });
});
