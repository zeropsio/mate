/**
 * The recipe a new Mate starts from, as HQ's stream carries the application's Mate tier: a tier
 * HQ says is not there is no recipe; a read that failed is not, nor is an HQ that says nothing of
 * the tier, nor a stream that has not said it yet. Nothing is read beside the stream.
 */
import { RegistryContext } from "@effect/atom-react";
import type { AppRead } from "@t3tools/shared/hqAppReads";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { hqStructureAtom } from "../state/zerops";
import { useZeropsGroupRecipe, type GroupRecipe } from "./useZeropsGroupRecipe";

vi.mock("../state/zerops", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { hqStructureAtom: Atom.make(null) };
});
const snapshots = vi.hoisted(() => [] as string[]);
vi.mock("./hqStructure", () => ({
  requestHqSnapshot: (organizationId: string) => snapshots.push(organizationId),
}));

/** What HQ's stream says of the Mate tier. */
type Said = "absent" | "recipe" | "unusable" | "failed" | "unsaid";

const RECIPE = "services:\n  - hostname: db\n    type: postgresql@16\n";
const ABSENT: RecipeTierResponse = { state: "absent" };

function readOf(said: Said): AppRead {
  if (said === "failed") {
    return { revision: "1", value: null, failure: { code: "repo_unavailable", reason: null } };
  }
  const mate: RecipeTierResponse | undefined =
    said === "unsaid"
      ? undefined
      : said === "absent"
        ? ABSENT
        : {
            state: "present",
            importYaml: said === "recipe" ? RECIPE : "project:\n  name: shop\n",
            mainHead: "a".repeat(40),
          };
  return {
    revision: "1",
    value: {
      releases: [],
      repos: [],
      recipes: { ...(mate === undefined ? {} : { mate }), stage: ABSENT, production: ABSENT },
    },
    failure: null,
  };
}

const registry = AtomRegistry.make();
function say(said: Said | null) {
  act(() => {
    registry.set(hqStructureAtom, {
      organizationId: "org-1",
      structure: null,
      changes: null,
      appReads: said === null ? null : new Map([["app-1", readOf(said)]]),
      readAt: 1_000,
      current: true,
      unavailableSince: null,
    });
  });
}

/** What the hook said, render by render. */
const renders: GroupRecipe[] = [];
const seen = () => renders.at(-1);

function Probe() {
  renders.push(useZeropsGroupRecipe({ appId: "app-1", tier: "mate", enabled: true }));
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  registry.set(hqStructureAtom, null);
  renders.length = 0;
  snapshots.length = 0;
});

function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(
      create(createElement(RegistryContext.Provider, { value: registry }, createElement(Probe))),
    );
  });
}

describe("useZeropsGroupRecipe", () => {
  it.each<{ readonly said: Said; readonly state: GroupRecipe["state"] }>([
    { said: "absent", state: "absent" },
    { said: "recipe", state: "present" },
    // HQ holds a tier this build finds no service in: nothing a Mate could be made from.
    { said: "unusable", state: "unreadable" },
    { said: "failed", state: "unreadable" },
    // An HQ from before the Mate tier rode its stream: not known, never "no recipe".
    { said: "unsaid", state: "unreadable" },
  ])("reads a Mate tier HQ's stream says $said as $state", ({ said, state }) => {
    mount();
    expect(seen()).toMatchObject({ state: "loading", loading: true });
    say(null);
    expect(seen()).toMatchObject({ state: "loading", loading: true });
    say(said);
    expect(seen()).toMatchObject({ state, loading: false });
    expect(seen()?.tier === undefined).toBe(state !== "present");
  });

  it("hands over the recipe's tier as main holds it, and its services", () => {
    // The creation's plan converts it: what goes in when depends on whether there is a Mate.
    say("recipe");
    mount();
    expect(seen()?.tier).toEqual({ kind: "tier", tier: "mate", yaml: RECIPE });
    expect(seen()?.services).toEqual(["db"]);
  });

  it("tries again through HQ's stream, keeping what it said until the snapshot lands", () => {
    say("failed");
    mount();
    act(() => {
      seen()?.reread();
    });
    expect(snapshots).toEqual(["org-1"]);
    expect(seen()).toMatchObject({ state: "unreadable", rereading: true });
    say("recipe");
    expect(seen()).toMatchObject({ state: "present", rereading: false });
  });
});
