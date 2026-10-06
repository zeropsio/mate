/**
 * The comparisons a release asks HQ for: each asked once and held for as long as HQ is the same —
 * two commits compare the same for ever — and a failed read ends until Compare again.
 */
import type { CompareRead } from "@t3tools/client-runtime/zerops";
import type { CompareResponse } from "@t3tools/shared/hqChanges";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { makeSampledAccount } from "./__fixtures__/sampledAccount";
import { useReleaseComparisons, type AppCompares } from "./useReleaseComparisons";
import { AccountDataContext, type AccountData } from "./ZeropsAccountData";

const OLD = "1".repeat(40);
const HEAD = "2".repeat(40);

/**
 * The organization's official HQ — one object, as `useOfficialHq` keeps it, or `null` while it is
 * not open here — and what the account's HQ socket answers and was asked.
 */
const hq = vi.hoisted(() => {
  const state = {
    open: true,
    asked: [] as Array<string>,
    failing: false,
    /** A new HQ for every test: what one HQ answered is held for the whole tab. */
    tests: 0,
  };
  const official = {
    address: "https://hq-0.example.test",
  };
  return { state, official };
});

vi.mock("./accountHq", () => ({
  useOfficialHq: () => (hq.state.open ? hq.official : null),
}));

const compare = vi.fn(
  async ({ appId, repo, base, head }: Parameters<AccountData["compare"]>[0]) => {
    hq.state.asked.push(`${appId} ${repo}`);
    if (hq.state.failing) throw new Error("HQ is not answering right now.");
    return {
      base: base ?? null,
      head,
      commits: [],
      truncated: false,
      total: 0,
    } satisfies CompareResponse;
  },
);

let registry: AtomRegistry.AtomRegistry;
let account: AccountData;
beforeEach(() => {
  hq.state.tests += 1;
  hq.official.address = `https://hq-${String(hq.state.tests)}.example.test`;
  registry = AtomRegistry.make();
  account = {
    ...makeSampledAccount({ registry, orgId: "org-1", answer: () => null }),
    compare,
  };
});

const READ: CompareRead = {
  repository: "appdev",
  query: { base: OLD, head: HEAD },
  services: ["app"],
};
const KEY = JSON.stringify(["appdev", OLD, HEAD]);

/** What the hook said, render by render. */
const renders: ReadonlyMap<string, AppCompares>[] = [];
const seen = () => renders.at(-1);

function Probe({ asks }: { readonly asks: ReadonlyMap<string, ReadonlyArray<CompareRead>> }) {
  return (
    <AccountDataContext value={hq.state.open ? account : null}>
      <Reader asks={asks} />
    </AccountDataContext>
  );
}

function Reader({ asks }: { readonly asks: ReadonlyMap<string, ReadonlyArray<CompareRead>> }) {
  renders.push(useReleaseComparisons(asks));
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  registry.dispose();
  compare.mockClear();
  hq.state.open = true;
  hq.state.asked = [];
  hq.state.failing = false;
  renders.length = 0;
  vi.useRealTimers();
});

async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

describe("useReleaseComparisons", () => {
  it("asks HQ each comparison of an application once, and holds its answer", async () => {
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    expect(hq.state.asked).toEqual(["a-todo appdev"]);
    expect(compare).toHaveBeenCalledExactlyOnceWith({
      appId: "a-todo",
      repo: "appdev",
      base: OLD,
      head: HEAD,
    });
    expect(seen()?.get("a-todo")?.answers.get(KEY)).toEqual({
      base: OLD,
      head: HEAD,
      commits: [],
      truncated: false,
      total: 0,
    });
  });

  it("asks nothing again for a comparison it holds, however the plan is rebuilt", async () => {
    const tree = await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    await act(async () => {
      tree.update(<Probe asks={new Map([["a-todo", [{ ...READ }]]])} />);
    });
    expect(hq.state.asked).toEqual(["a-todo appdev"]);
  });

  it("ends a failed comparison until a reader asks once again", async () => {
    vi.useFakeTimers();
    hq.state.failing = true;
    const tree = await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    expect(seen()?.get("a-todo")?.failures).toEqual(
      new Map([[KEY, "HQ is not answering right now."]]),
    );
    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });
    await act(async () => {
      tree.update(<Probe asks={new Map([["a-todo", [{ ...READ }]]])} />);
    });
    expect(hq.state.asked).toEqual(["a-todo appdev"]);
    hq.state.failing = false;
    await act(async () => {
      seen()?.get("a-todo")?.again([READ]);
    });
    expect(hq.state.asked).toEqual(["a-todo appdev", "a-todo appdev"]);
    expect(seen()?.get("a-todo")?.answers.has(KEY)).toBe(true);
    expect(seen()?.get("a-todo")?.failures).toEqual(new Map());
  });

  it("a failed manual attempt ends again, and simultaneous presses share one attempt", async () => {
    vi.useFakeTimers();
    hq.state.failing = true;
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    const again = seen()!.get("a-todo")!.again;
    await act(async () => {
      again([READ]);
      again([READ]);
    });
    expect(hq.state.asked).toHaveLength(2);
    expect(seen()?.get("a-todo")?.failures.get(KEY)).toBe("HQ is not answering right now.");
    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });
    expect(hq.state.asked).toHaveLength(2);
  });

  it("new revisions originate one new read without retrying the failed revision", async () => {
    hq.state.failing = true;
    const tree = await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    hq.state.failing = false;
    const next = { ...READ, query: { base: OLD, head: "3".repeat(40) } };
    await act(async () => {
      tree.update(<Probe asks={new Map([["a-todo", [next]]])} />);
    });
    expect(hq.state.asked).toHaveLength(2);
    expect(seen()?.get("a-todo")?.failures.size).toBe(0);
    expect(seen()?.get("a-todo")?.answers.size).toBe(1);
  });

  it("asks nothing while the organization's HQ is not open here", async () => {
    hq.state.open = false;
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    expect(hq.state.asked).toEqual([]);
    expect(seen()?.get("a-todo")?.answers).toEqual(new Map());
  });

  it("holds comparisons only with the surface that asked for them", async () => {
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    expect(hq.state.asked).toEqual(["a-todo appdev", "a-todo appdev"]);
    expect(seen()?.get("a-todo")?.answers.has(KEY)).toBe(true);
  });

  it("lets go of another account's comparisons when the account changes", async () => {
    const tree = await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    const nextCompare = vi.fn(async () => {
      throw new Error("No access in this account.");
    });
    account = { ...account, compare: nextCompare };
    await act(async () => {
      tree.update(<Probe asks={new Map([["a-todo", [READ]]])} />);
    });
    expect(nextCompare).toHaveBeenCalledOnce();
    expect(seen()?.get("a-todo")?.answers.size).toBe(0);
    expect(seen()?.get("a-todo")?.failures.get(KEY)).toBe("No access in this account.");
  });
});
