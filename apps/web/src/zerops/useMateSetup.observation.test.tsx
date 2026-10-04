import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const source = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@t3tools/client-runtime/zerops/mateSetup", () => ({ readMateSetup: source.read }));
import { useMateSetup } from "./useMateSetup";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";

const trees: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
  closeAccountLifetime();
  source.read.mockReset();
});
describe("one setup observation per Mate on screen", () => {
  it("shares one source read between the empty conversation and composer", async () => {
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue({
      kind: "setup",
      setup: { at: "now", git: "done", runtimes: "none", standup: "failed" },
    });
    const seen: Array<string | undefined> = [];
    function View() {
      seen.push(useMateSetup("https://mate.test")?.standup);
      return null;
    }
    await act(async () => {
      trees.push(create(createElement(View)), create(createElement(View)));
    });
    expect(source.read).toHaveBeenCalledOnce();
    expect(seen.at(-1)).toBe("failed");
  });
});

describe("a setup still on its way", () => {
  /** The tab's document, as far as visibility goes. */
  function stubDocument() {
    const listeners = new Set<() => void>();
    const page = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal("document", page);
    return {
      listeners,
      show: (state: DocumentVisibilityState) => {
        page.visibilityState = state;
        for (const listener of listeners) listener();
      },
    };
  }

  it("is read every few seconds while shown, never while the tab is hidden, once on its return", async () => {
    vi.useFakeTimers();
    const tab = stubDocument();
    try {
      openAccountLifetime("setup-viewer");
      source.read.mockResolvedValue({
        kind: "setup",
        setup: { at: "now", git: "done", runtimes: "running", standup: "waiting" },
      });
      function View() {
        useMateSetup("https://mate.test");
        return null;
      }
      await act(async () => {
        trees.push(create(createElement(View)));
      });
      expect(source.read).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(source.read).toHaveBeenCalledTimes(2);
      tab.show("hidden");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(source.read).toHaveBeenCalledTimes(2);
      await act(async () => {
        tab.show("visible");
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(source.read).toHaveBeenCalledTimes(3);
      await act(async () => {
        for (const tree of trees.splice(0)) tree.unmount();
      });
      expect(tab.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
