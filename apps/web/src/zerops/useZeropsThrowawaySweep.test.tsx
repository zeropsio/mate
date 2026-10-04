import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  makeThrowawayDebt,
  THROWAWAY_SWEEP_AGE_MS,
  type ThrowawayDebt,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import { useZeropsThrowawaySweep } from "./useZeropsThrowawaySweep";

const NOW = Date.parse("2026-10-04T10:00:00Z");
const mocks = vi.hoisted(() => ({
  debt: undefined as ThrowawayDebt | undefined,
  read: vi.fn(),
  remove: vi.fn(),
  runtime: { scope: { account: "ada" }, cells: {} },
  organizationRef: (id: string) => ({ organizationId: id }),
}));
vi.mock("./throwawayDebt", () => ({ accountThrowawayDebt: () => mocks.debt }));
vi.mock("./readZeropsCell", () => ({
  readZeropsCell: (...args: unknown[]) => mocks.read(...args),
}));
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    runtime: mocks.runtime,
    organizationRef: mocks.organizationRef,
  }),
}));
vi.mock("./ZeropsSessionProvider", () => {
  const client = {
    session: { userId: "ada" },
    deleteIntegrationToken: (...args: unknown[]) => mocks.remove(...args),
  };
  return { useZeropsSession: () => ({ client }) };
});

let tree: ReactTestRenderer | undefined;
let shown: ReturnType<typeof useZeropsThrowawaySweep>;
function Probe({ enabled = true, clientId = "org-1" }: { enabled?: boolean; clientId?: string }) {
  shown = useZeropsThrowawaySweep({ enabled, clientId });
  return null;
}
const tokens = [
  {
    tokenId: "stale",
    name: "mate-door:p:n1",
    created: new Date(NOW - THROWAWAY_SWEEP_AGE_MS - 1001).toISOString(),
  },
  { tokenId: "young", name: "mate-door:p:n2", created: new Date(NOW).toISOString() },
  { tokenId: "working", name: "mate-hq:p:address", created: new Date(0).toISOString() },
];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.debt = makeThrowawayDebt();
  mocks.read.mockReset().mockResolvedValue(tokens);
  mocks.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(enabled = true) {
  await act(async () => {
    tree = create(<Probe enabled={enabled} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function again() {
  await act(async () => {
    shown.again();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("inventory throwaway cleanup", () => {
  it("restores crash debt and sweeps once after inventory is granted, then settles it durably", async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    makeThrowawayDebt(storage).owe("org-1", NOW - THROWAWAY_SWEEP_AGE_MS - 1001, "mate-door:p:n1");
    mocks.debt = makeThrowawayDebt(storage);
    await mount(false);
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => {
      tree!.update(<Probe />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(
      { clientId: "org-1", tokenId: "stale" },
      expect.any(AbortSignal),
    );
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(makeThrowawayDebt(storage).failedAt("org-1")).toBeNull();
    expect(shown.state).toBe("done");
  });

  it("does not list tokens without debt; explicit cleanup discovers legacy leftovers", async () => {
    mocks.read.mockResolvedValue([
      { tokenId: "legacy", name: "gitea-signin:nonce", created: new Date(0).toISOString() },
    ]);
    await mount();
    expect(mocks.read).not.toHaveBeenCalled();
    await again();
    expect(mocks.remove).toHaveBeenCalledWith(
      { clientId: "org-1", tokenId: "legacy" },
      expect.any(AbortSignal),
    );
    expect(shown.state).toBe("done");
  });

  it("leaves a failed cleanup visible and owed until manual again", async () => {
    mocks.debt!.owe("org-1", NOW - THROWAWAY_SWEEP_AGE_MS - 1001);
    mocks.remove.mockRejectedValueOnce(new Error("Zerops did not answer."));
    await mount();
    expect(shown).toMatchObject({ state: "failed", failure: "Zerops did not answer." });
    expect(mocks.debt!.failedAt("org-1")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    await again();
    expect(mocks.remove.mock.calls.filter(([input]) => input.tokenId === "stale")).toHaveLength(2);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(shown.state).toBe("done");
  });

  it("a failed sweep survives reload and still requires manual again", async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    mocks.debt = makeThrowawayDebt(storage);
    mocks.debt.owe("org-1", NOW - THROWAWAY_SWEEP_AGE_MS - 1001);
    mocks.remove.mockRejectedValueOnce(new Error("Zerops did not answer."));
    await mount();
    expect(shown.state).toBe("failed");
    act(() => tree!.unmount());
    tree = undefined;
    mocks.debt = makeThrowawayDebt(storage);
    await mount();
    expect(shown.state).toBe("failed");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await again();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(shown.state).toBe("done");
  });

  it("queues fresh debt until the door window ends, without sweeping a live throwaway", async () => {
    mocks.debt!.owe("org-1", NOW);
    await mount();
    expect(shown.state).toBe("waiting");
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THROWAWAY_SWEEP_AGE_MS + 1000);
    });
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(shown.state).toBe("done");
  });

  it("an explicit cleanup belongs to its organization and never starts one in the next", async () => {
    await mount();
    await again();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree!.update(<Probe clientId="org-2" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("drops a late token list after the organization changes", async () => {
    mocks.debt!.owe("org-1", NOW - THROWAWAY_SWEEP_AGE_MS - 1001);
    let answer: ((value: typeof tokens) => void) | undefined;
    mocks.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await mount();
    await act(async () => {
      tree!.update(<Probe clientId="org-2" />);
    });
    await act(async () => {
      answer!(tokens);
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.debt!.failedAt("org-1")).not.toBeNull();
  });
});
