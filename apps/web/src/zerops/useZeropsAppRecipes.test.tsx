/**
 * What each application's recipe on `main` offers, read through the organization's HQ as the
 * person: its stage's and its production's tier, read when it is first shown and again when a
 * change of its recipe lands.
 */
import type { AppRecipe } from "@t3tools/client-runtime/zerops";
import type { RecipeTier, RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RECIPES_RETRY_MS, useZeropsAppRecipes } from "./useZeropsAppRecipes";

const hq = vi.hoisted(() => {
  const reads: Array<{
    readonly appId: string;
    readonly tier: RecipeTier;
    readonly signal: AbortSignal;
    readonly resolve: (tier: RecipeTierResponse) => void;
    readonly reject: (cause: unknown) => void;
  }> = [];
  const official = {
    address: "https://hq.example.test",
    api: {
      recipeTier: (appId: string, tier: RecipeTier, signal: AbortSignal) =>
        new Promise<RecipeTierResponse>((resolve, reject) => {
          reads.push({ appId, tier, signal, resolve, reject });
        }),
    },
  };
  return { reads, official, open: true };
});

vi.mock("./accountHq", () => ({
  useOfficialHq: () => (hq.open ? hq.official : null),
}));

const STAGE = [
  "services:",
  "  - hostname: app",
  "    type: nodejs@22",
  "    buildFromGit: https://hq.example.test/git/app-1/appdev.git",
  "    zeropsSetup: app",
  "",
].join("\n");

const renders: Array<ReadonlyMap<string, AppRecipe>> = [];
const seen = () => renders.at(-1);

function Probe({ revision }: { readonly revision?: string | undefined }) {
  renders.push(useZeropsAppRecipes({ apps: new Map([["app-1", revision]]), enabled: true }));
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
  vi.useRealTimers();
});

function mount(revision?: string): ReactTestRenderer {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<Probe revision={revision} />);
  });
  mounted.push(tree!);
  return tree!;
}

/** Answers the oldest read still waiting: the tier `main` holds, or none. */
async function answer(tier: RecipeTier, file: string | null) {
  const read = hq.reads.shift();
  expect(read).toMatchObject({ appId: "app-1", tier });
  await act(async () => {
    read?.resolve(
      file === null
        ? { state: "absent" }
        : { state: "present", importYaml: file, mainHead: "a".repeat(40) },
    );
  });
}

describe("useZeropsAppRecipes", () => {
  it("reads an application's stage and production through HQ, and offers what main holds", async () => {
    mount();
    await answer("stage", STAGE);
    await answer("production", null);
    expect(seen()?.get("app-1")).toEqual({
      tiers: ["stage"],
      repositories: new Map([["app", "appdev"]]),
      productionRepositories: new Map(),
    });
  });

  it.each(["in flight", "settled"])(
    "adopts the first known recipe revision while bootstrap is %s",
    async (phase) => {
      const tree = mount();
      const signals = hq.reads.map(({ signal }) => signal);
      if (phase === "settled") {
        await answer("stage", STAGE);
        await answer("production", null);
      }
      const pending = hq.reads.length;
      act(() => {
        tree.update(<Probe revision={"b".repeat(40)} />);
      });
      expect(hq.reads).toHaveLength(pending);
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
      if (phase === "in flight") {
        await answer("stage", STAGE);
        await answer("production", null);
      }
      expect(seen()?.get("app-1")?.tiers).toEqual(["stage"]);
      act(() => {
        tree.update(<Probe revision={"c".repeat(40)} />);
      });
      expect(hq.reads).toHaveLength(2);
      await answer("stage", STAGE);
      await answer("production", STAGE);
      expect(seen()?.get("app-1")?.tiers).toEqual(["stage", "production"]);
    },
  );

  it("reads again once a change of the recipe lands, and keeps what it read meanwhile", async () => {
    const tree = mount("b".repeat(40));
    await answer("stage", null);
    await answer("production", null);
    act(() => {
      tree.update(<Probe revision={"c".repeat(40)} />);
    });
    expect(seen()?.get("app-1")?.tiers).toEqual([]);
    await answer("stage", STAGE);
    await answer("production", STAGE);
    expect(seen()?.get("app-1")?.tiers).toEqual(["stage", "production"]);
  });

  it("keeps what it read when a read fails", async () => {
    const tree = mount("b".repeat(40));
    await answer("stage", STAGE);
    await answer("production", null);
    act(() => {
      tree.update(<Probe revision={"c".repeat(40)} />);
    });
    await act(async () => {
      hq.reads.shift()?.reject(new Error("HQ is not answering right now."));
    });
    expect(seen()?.get("app-1")?.tiers).toEqual(["stage"]);
  });

  // F20 (e2e, 2026-10-03): the Developer's C read "Production · Not set up" with no Add production
  // while its menu offered it — HQ had not answered the recipe once (a Core taking over, the door's
  // budget spent), and nothing asked again, so production stayed a tier main does not offer.
  it.each([
    { name: "a Core taking over", cause: new Error("HQ is not the active one right now.") },
    { name: "the door's budget spent", cause: new Error("Too many requests.") },
  ])(
    "asks again a minute after HQ did not answer ($name), though nothing else changed",
    async ({ cause }) => {
      vi.useFakeTimers();
      mount();
      await act(async () => {
        hq.reads.shift()?.reject(cause);
      });
      // The pair's other read is left unanswered: the first refusal already failed the read.
      hq.reads.length = 0;
      expect(seen()?.has("app-1")).toBe(false);
      act(() => {
        vi.advanceTimersByTime(RECIPES_RETRY_MS - 1);
      });
      expect(hq.reads).toEqual([]);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      await answer("stage", STAGE);
      await answer("production", STAGE);
      expect(seen()?.get("app-1")?.tiers).toEqual(["stage", "production"]);
    },
  );

  it("reads nothing while the organization's HQ is not open here", () => {
    hq.open = false;
    mount();
    expect(hq.reads).toEqual([]);
    expect(seen()?.size).toBe(0);
  });
});
