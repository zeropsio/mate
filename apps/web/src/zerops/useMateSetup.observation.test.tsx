import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { makeAccountStore } from "@t3tools/client-runtime/data";
import { STREAM_POLICY } from "@t3tools/client-runtime/data";
const account = vi.hoisted(() => ({
  store: null as import("@t3tools/client-runtime/data").AccountStore | null,
}));
vi.mock("./ZeropsAccountData", () => ({
  useAccountStoreForAdapters: () => account.store,
  useAccountDataOptional: () => ({ orgId: "org-1" }),
}));
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const source = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@t3tools/client-runtime/zerops/mateSetup", () => ({ readMateSetup: source.read }));
import { refreshMateSetup, useMateSetup, type MateSetupObserved } from "./useMateSetup";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";

let registry: ReturnType<typeof AtomRegistry.make>;
beforeEach(() => {
  registry = AtomRegistry.make();
  account.store = makeAccountStore(registry);
});
function viewWithAccount(element: React.ReactNode) {
  return createElement(RegistryContext.Provider, { value: registry }, element);
}
const trees: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
  closeAccountLifetime();
  account.store?.close();
  registry.dispose();
  source.read.mockReset();
  vi.useRealTimers();
});

const UNSETTLED = { at: "now", git: "done", runtimes: "running", standup: "waiting" } as const;

/** Mounts one reader of `origin`'s setup, and what it has seen; `rekey` changes its epoch. */
async function watch(
  origin = "https://mate.test",
  epoch?: string,
): Promise<Array<MateSetupObserved> & { rekey: (next: string) => Promise<void> }> {
  const seen = [] as unknown as Array<MateSetupObserved> & {
    rekey: (next: string) => Promise<void>;
  };
  function View(props: { readonly epoch: string | undefined }) {
    seen.push(useMateSetup(origin, props.epoch));
    return null;
  }
  const tree = await (async () => {
    let created: ReactTestRenderer | undefined;
    await act(async () => {
      created = create(viewWithAccount(createElement(View, { epoch })));
    });
    return created!;
  })();
  trees.push(tree);
  seen.rekey = async (next) => {
    await act(async () => {
      tree.update(viewWithAccount(createElement(View, { epoch: next })));
    });
  };
  return seen;
}

describe("one setup observation per Mate on screen", () => {
  it("shares one source read between the empty conversation and composer", async () => {
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue({
      kind: "setup",
      setup: { at: "now", git: "done", runtimes: "none", standup: "failed" },
    });
    const seen: Array<string | undefined> = [];
    function View() {
      seen.push(useMateSetup("https://mate.test").setup?.standup);
      return null;
    }
    await act(async () => {
      trees.push(
        create(viewWithAccount(createElement(View))),
        create(viewWithAccount(createElement(View))),
      );
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

  it("opened in a hidden tab, is read only once the tab is shown", async () => {
    const tab = stubDocument();
    tab.show("hidden");
    try {
      openAccountLifetime("setup-viewer");
      source.read.mockResolvedValue({
        kind: "setup",
        setup: { at: "now", git: "done", runtimes: "none", standup: "done" },
      });
      function View() {
        useMateSetup("https://mate.test");
        return null;
      }
      await act(async () => {
        trees.push(create(viewWithAccount(createElement(View))));
      });
      expect(source.read).not.toHaveBeenCalled();
      await act(async () => {
        tab.show("visible");
      });
      expect(source.read).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
        trees.push(create(viewWithAccount(createElement(View))));
      });
      expect(source.read).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STREAM_POLICY.sampledIntervalMs);
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
      await vi.advanceTimersByTimeAsync(STREAM_POLICY.sampledIntervalMs * 2);
      expect(source.read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

// A read that can't be the setup is a failure the view says, and the observation ends there: no
// timer reads it again. Only a read with nothing answering yet, or a setup still under way, is
// read again.
describe("what ends a setup observation", () => {
  it.each([
    { reading: { kind: "refused" }, failure: "refused", readsAgain: false },
    { reading: { kind: "invalid" }, failure: "invalid", readsAgain: false },
    { reading: { kind: "absent" }, failure: undefined, readsAgain: false },
    { reading: { kind: "unreachable" }, failure: undefined, readsAgain: true },
    { reading: { kind: "setup", setup: UNSETTLED }, failure: undefined, readsAgain: true },
  ] as const)("$reading.kind", async ({ reading, failure, readsAgain }) => {
    vi.useFakeTimers();
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue(reading);
    const seen = await watch();
    expect(seen.at(-1)?.failure).toBe(failure);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAM_POLICY.sampledIntervalMs * 5);
    });
    expect(source.read.mock.calls.length > 1).toBe(readsAgain);
  });

  it("keeps the last setup its Mate told through a failure that follows", async () => {
    vi.useFakeTimers();
    openAccountLifetime("setup-viewer");
    source.read
      .mockResolvedValueOnce({ kind: "setup", setup: UNSETTLED })
      .mockResolvedValue({ kind: "refused" });
    const seen = await watch();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAM_POLICY.sampledIntervalMs);
    });
    expect(seen.at(-1)).toEqual({ setup: UNSETTLED, failure: "refused" });
  });
});

// Web review #4 (2026-10-05): a failed setup read is definitive for that read, never for the Mate:
// the person's Try again reads it again, and so does a changed input — a redeploy, or its server
// restarting.
describe("what reads a failed setup again", () => {
  it("the person's Try again reads it again, and a setup that answers clears the failure", async () => {
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValueOnce({ kind: "refused" }).mockResolvedValue({
      kind: "setup",
      setup: { at: "now", git: "done", runtimes: "none", standup: "none" },
    });
    const seen = await watch();
    expect(seen.at(-1)?.failure).toBe("refused");
    await act(async () => {
      refreshMateSetup("https://mate.test");
    });
    expect(source.read).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toMatchObject({ failure: undefined, setup: { git: "done" } });
  });

  it.each([
    { case: "a changed input reads it again", next: "env-b|ready", reads: 2 },
    { case: "the same input reads nothing", next: "env-a|ready", reads: 1 },
  ])("$case", async ({ next, reads }) => {
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue({ kind: "invalid" });
    const seen = await watch("https://mate.test", "env-a|ready");
    expect(seen.at(-1)?.failure).toBe("invalid");
    await seen.rekey(next);
    expect(source.read).toHaveBeenCalledTimes(reads);
  });
});

describe("setup demand recovery", () => {
  it("retains a refusal through remount without reading it again", async () => {
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue({ kind: "refused" });
    await watch();
    await act(async () => {
      for (const tree of trees.splice(0)) tree.unmount();
    });
    const seen = await watch();
    expect(seen.at(-1)?.failure).toBe("refused");
    expect(source.read).toHaveBeenCalledOnce();
  });
  it("a late answer from a closed account cannot populate the next account", async () => {
    openAccountLifetime("setup-viewer");
    let answer: ((value: unknown) => void) | undefined;
    source.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await watch();
    await act(async () => {
      for (const tree of trees.splice(0)) tree.unmount();
    });
    closeAccountLifetime();
    account.store?.close();
    registry.dispose();
    registry = AtomRegistry.make();
    account.store = makeAccountStore(registry);
    openAccountLifetime("another-viewer");
    await act(async () => {
      answer?.({ kind: "setup", setup: UNSETTLED });
    });
    expect(account.store.state().facts.size).toBe(0);
  });
});
