/**
 * The comparisons a release asks HQ for: each asked once and held for as long as HQ is the same —
 * two commits compare the same for ever — and a failed read ends until Compare again.
 */
import type { CompareRead } from "@t3tools/client-runtime/zerops";
import type { CompareQuery, CompareResponse } from "@t3tools/shared/hqChanges";
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsCompares, type ZeropsCompares } from "./useZeropsCompares";

const OLD = "1".repeat(40);
const HEAD = "2".repeat(40);

/**
 * The organization's official HQ — one object, as `useOfficialHq` keeps it, or `null` while it is
 * not open here — what it answers, and what it was asked.
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
    api: {
      compare: async (appId: string, repo: string, query: CompareQuery) => {
        state.asked.push(`${appId} ${repo}`);
        if (state.failing) throw new Error("HQ is not answering right now.");
        return {
          base: query.base ?? null,
          head: query.head,
          commits: [],
          truncated: false,
          total: 0,
        } satisfies CompareResponse;
      },
    },
  };
  return { state, official };
});

vi.mock("./accountHq", () => ({
  useOfficialHq: () => (hq.state.open ? hq.official : null),
}));

beforeEach(() => {
  hq.state.tests += 1;
  hq.official.address = `https://hq-${String(hq.state.tests)}.example.test`;
});

const READ: CompareRead = {
  repository: "appdev",
  query: { base: OLD, head: HEAD },
  services: ["app"],
};
const KEY = JSON.stringify(["appdev", OLD, HEAD]);

/** What the hook said, render by render. */
const renders: ZeropsCompares[] = [];
const seen = () => renders.at(-1);

function Probe({ asks }: { readonly asks: ReadonlyMap<string, ReadonlyArray<CompareRead>> }) {
  renders.push(useZeropsCompares(asks));
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
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

describe("useZeropsCompares", () => {
  it("asks HQ each comparison of an application once, and holds its answer", async () => {
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    expect(hq.state.asked).toEqual(["a-todo appdev"]);
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

  it("asks a comparison another surface asked already of nobody: one store per HQ", async () => {
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    await mount(<Probe asks={new Map([["a-todo", [READ]]])} />);
    expect(hq.state.asked).toEqual(["a-todo appdev"]);
    expect(seen()?.get("a-todo")?.answers.has(KEY)).toBe(true);
  });
});
