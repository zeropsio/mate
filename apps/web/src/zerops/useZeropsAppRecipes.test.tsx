import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useZeropsAppRecipes, useZeropsRecipeFailure } from "./useZeropsAppRecipes";
import { hqStructureAtom } from "../state/zerops";

vi.mock("../state/zerops", () => ({ hqStructureAtom: Atom.make(null) }));
const snapshot = vi.hoisted(() => vi.fn());
vi.mock("./hqStructure", () => ({ requestHqSnapshot: snapshot }));
afterEach(() => {
  vi.useRealTimers();
  snapshot.mockClear();
});

describe("streamed application recipes", () => {
  it("keeps a failed recipe unavailable until Read recipe again; a new revision supplies knowledge", async () => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const registry = AtomRegistry.make();
    const read = {
      revision: "1",
      value: null,
      failure: { code: "too_large", reason: "recipe_too_large" },
    };
    const state = {
      organizationId: "org",
      structure: null,
      changes: null,
      appReads: new Map([["app", read]]),
      readAt: 1000,
      current: true,
      unavailableSince: null,
    };
    registry.set(hqStructureAtom, state);
    const renders: Array<{
      recipes: ReturnType<typeof useZeropsAppRecipes>;
      failure: ReturnType<typeof useZeropsRecipeFailure>;
    }> = [];
    const seen = () => renders.at(-1)!;
    function Probe() {
      renders.push({ recipes: useZeropsAppRecipes(), failure: useZeropsRecipeFailure("app") });
      return null;
    }
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <RegistryContext.Provider value={registry}>
          <Probe />
        </RegistryContext.Provider>,
      );
    });
    expect(seen().recipes.has("app")).toBe(false);
    expect(seen().failure?.reason).toBe("This project's recipe is too large to read here.");
    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });
    expect(snapshot).not.toHaveBeenCalled();
    act(() => {
      seen().failure?.again();
    });
    expect(snapshot).toHaveBeenCalledExactlyOnceWith("org");
    const stage = {
      state: "present" as const,
      mainHead: "a".repeat(40),
      importYaml: "services:\n  - hostname: app\n    type: nodejs@22\n",
    };
    await act(async () => {
      registry.set(hqStructureAtom, {
        ...state,
        appReads: new Map([
          [
            "app",
            {
              revision: "2",
              failure: null,
              value: {
                repos: [],
                releases: [],
                recipes: { stage, production: { state: "absent" as const } },
              },
            },
          ],
        ]),
      });
    });
    expect(seen().failure).toBeUndefined();
    expect(seen().recipes.get("app")?.tiers).toEqual(["stage"]);
    expect(snapshot).toHaveBeenCalledOnce();
    await act(async () => {
      tree.unmount();
    });
    registry.dispose();
  });
});
