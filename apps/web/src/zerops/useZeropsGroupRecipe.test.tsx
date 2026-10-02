/**
 * The recipe a new Mate starts from, read off the application's recipe in HQ as the person: a tier
 * HQ says is not there is no recipe, a read that failed is not — and neither is a read that could
 * not go out yet.
 */
import type { RecipeTier, RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { forgetGroupRecipes, useZeropsGroupRecipe, type GroupRecipe } from "./useZeropsGroupRecipe";

/**
 * The organization's official HQ — one object, as `useOfficialHq` keeps it, or `null` while it is
 * not open here — and each read of a tier still waiting on its answer.
 */
const hq = vi.hoisted(() => {
  const reads: Array<{
    readonly appId: string;
    readonly tier: RecipeTier;
    readonly resolve: (tier: RecipeTierResponse) => void;
    readonly reject: (cause: unknown) => void;
  }> = [];
  const official = {
    address: "https://hq.example.test",
    api: {
      recipeTier: (appId: string, tier: RecipeTier) =>
        new Promise<RecipeTierResponse>((resolve, reject) => {
          reads.push({ appId, tier, resolve, reject });
        }),
    },
  };
  return { reads, official, open: true };
});

vi.mock("./accountHq", () => ({
  useOfficialHq: () => (hq.open ? hq.official : null),
}));

/** What HQ answers: a tier `main` does not hold, the recipe, one it cannot use, or a failed read. */
type Answer = "absent" | "recipe" | "unusable" | "fails";

const RECIPE = "services:\n  - hostname: db\n    type: postgresql@16\n";

/** What the hook said, render by render. */
const renders: GroupRecipe[] = [];
const seen = () => renders.at(-1);

function Probe({ revision }: { readonly revision?: string | undefined }) {
  renders.push(useZeropsGroupRecipe({ appId: "app-1", tier: "mate", enabled: true, revision }));
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  hq.open = true;
  hq.reads.length = 0;
  renders.length = 0;
  forgetGroupRecipes();
});

function mount(element: ReactElement): ReactTestRenderer {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

/** Answers the oldest read still waiting, which asked for the application's Mate tier. */
async function answer(with_: Answer) {
  const read = hq.reads.shift();
  expect(read).toMatchObject({ appId: "app-1", tier: "mate" });
  await act(async () => {
    if (with_ === "fails") read?.reject(new Error("HQ is not answering right now."));
    else if (with_ === "absent") read?.resolve({ state: "absent" });
    else
      read?.resolve({
        state: "present",
        importYaml: with_ === "recipe" ? RECIPE : "project:\n  name: shop\n",
        mainHead: "a".repeat(40),
      });
  });
}

describe("useZeropsGroupRecipe", () => {
  it.each<{ readonly main: Answer; readonly state: GroupRecipe["state"] }>([
    { main: "absent", state: "absent" },
    { main: "recipe", state: "present" },
    // HQ holds a tier this build finds no service in: nothing a Mate could be made from.
    { main: "unusable", state: "unreadable" },
    { main: "fails", state: "unreadable" },
  ])("reads a tier HQ answers $main as $state", async ({ main, state }) => {
    mount(<Probe />);
    expect(seen()?.state).toBe("loading");
    await answer(main);
    expect(seen()?.state).toBe(state);
    expect(seen()?.tier === undefined).toBe(state !== "present");
  });

  it("hands over the recipe's tier as main holds it, and its services", async () => {
    // The creation's plan converts it: what goes in when depends on whether there is a Mate.
    mount(<Probe />);
    await answer("recipe");
    expect(seen()?.tier).toEqual({ kind: "tier", tier: "mate", yaml: RECIPE });
    expect(seen()?.services).toEqual(["db"]);
  });

  // The product opens only over its official HQ (`hqGate.ts`): until it is open here the recipe is
  // not known to be missing.
  it("asks nothing while the organization's HQ is not open here, and reads once it is", async () => {
    hq.open = false;
    const tree = mount(<Probe />);
    expect(seen()?.state).toBe("loading");
    expect(hq.reads).toEqual([]);
    hq.open = true;
    act(() => {
      tree.update(<Probe />);
    });
    await answer("absent");
    expect(seen()?.state).toBe("absent");
  });

  it("tries again keeping what it said until the new answer, busy meanwhile", async () => {
    mount(<Probe />);
    await answer("fails");
    act(() => {
      seen()?.reread();
    });
    expect(seen()).toMatchObject({ state: "unreadable", rereading: true });
    await answer("recipe");
    expect(seen()).toMatchObject({ state: "present", rereading: false });
  });

  it("reads again from nothing once a proposal lands, not when the changes are first known", async () => {
    const tree = mount(<Probe revision={undefined} />);
    await answer("absent");
    act(() => {
      tree.update(<Probe revision="" />);
    });
    expect(seen()?.state).toBe("absent");
    expect(hq.reads).toEqual([]);
    act(() => {
      tree.update(<Probe revision="13" />);
    });
    expect(seen()?.state).toBe("loading");
    await answer("recipe");
    expect(seen()?.state).toBe("present");
  });

  it.each<{ readonly first: Answer; readonly said: GroupRecipe["state"] }>([
    { first: "absent", said: "absent" },
    { first: "recipe", said: "present" },
    { first: "fails", said: "loading" },
  ])(
    "opened again after $first, says $said at once and holds Add until it has read anew",
    async ({ first, said }) => {
      const tree = mount(<Probe />);
      await answer(first);
      act(() => {
        tree.unmount();
      });
      mounted.splice(0);

      mount(<Probe />);
      expect(seen()).toMatchObject({ state: said, loading: true });
      await answer("recipe");
      expect(seen()).toMatchObject({ state: "present", loading: false });
    },
  );
});
