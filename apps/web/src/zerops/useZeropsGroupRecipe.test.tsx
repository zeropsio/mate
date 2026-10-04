/**
 * The recipe a new Mate starts from: the Mate tier HQ's stream carries, while it serves. Where it
 * carries none — a Core from before it did, or one that could not read it — and while the stream
 * is down, it is read on its own, through the store, while the dialog is open and the tab shown;
 * what was said before that read is said, never acted on.
 */
import { RegistryContext } from "@effect/atom-react";
import type { AppRead } from "@t3tools/shared/hqAppReads";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { hqStructureAtom } from "../state/zerops";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { useZeropsGroupRecipe, type GroupRecipe } from "./useZeropsGroupRecipe";

vi.mock("../state/zerops", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { hqStructureAtom: Atom.make(null) };
});
const snapshots = vi.hoisted(() => [] as string[]);
vi.mock("./hqStructure", () => ({
  requestHqSnapshot: (organizationId: string) => snapshots.push(organizationId),
}));

/** The organization's official HQ, and each read of the Mate tier still waiting on its answer. */
const hq = vi.hoisted(() => {
  const reads: Array<{
    readonly appId: string;
    readonly resolve: (tier: RecipeTierResponse) => void;
    readonly reject: (cause: unknown) => void;
  }> = [];
  const official = {
    address: "https://hq.example.test",
    api: {
      mateRecipe: (appId: string) =>
        new Promise<RecipeTierResponse>((resolve, reject) => {
          reads.push({ appId, resolve, reject });
        }),
    },
  };
  return { reads, official };
});
vi.mock("./accountHq", () => ({ useOfficialHq: () => hq.official }));

/** What HQ's stream says of the Mate tier; `unsaid` is a Core from before it said it. */
type Said = "absent" | "recipe" | "unusable" | "failed" | "unsaid";

const RECIPE = "services:\n  - hostname: db\n    type: postgresql@16\n";
const ABSENT: RecipeTierResponse = { state: "absent" };
const PRESENT: RecipeTierResponse = {
  state: "present",
  importYaml: RECIPE,
  mainHead: "a".repeat(40),
};

function readOf(said: Said): AppRead {
  if (said === "failed") {
    return { revision: "1", value: null, failure: { code: "repo_unavailable", reason: null } };
  }
  const mate: RecipeTierResponse | undefined =
    said === "unsaid"
      ? undefined
      : said === "absent"
        ? ABSENT
        : said === "recipe"
          ? PRESENT
          : { state: "present", importYaml: "project:\n  name: shop\n", mainHead: "a".repeat(40) };
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
/** HQ's stream, serving or down since a while, as it last said the application's tiers. */
function say(said: Said | null, stream: "serving" | "down" = "serving") {
  act(() => {
    registry.set(hqStructureAtom, {
      organizationId: "org-1",
      structure: null,
      changes: null,
      appReads: said === null ? null : new Map([["app-1", readOf(said)]]),
      readAt: 1_000,
      current: stream === "serving",
      unavailableSince: stream === "serving" ? null : 2_000,
    });
  });
}

/** Answers the oldest read of the Mate tier still waiting. */
async function answer(with_: RecipeTierResponse | "fails") {
  const read = hq.reads.shift();
  expect(read?.appId).toBe("app-1");
  await act(async () => {
    if (with_ === "fails") read?.reject(new Error("HQ is not answering right now."));
    else read?.resolve(with_);
  });
}

/** What the hook said, render by render. */
const renders: GroupRecipe[] = [];
const seen = () => renders.at(-1)!;

function Probe({ enabled = true }: { readonly enabled?: boolean }) {
  renders.push(useZeropsGroupRecipe({ appId: "app-1", tier: "mate", enabled }));
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  closeAccountLifetime();
  registry.set(hqStructureAtom, null);
  renders.length = 0;
  snapshots.length = 0;
  hq.reads.length = 0;
  vi.unstubAllGlobals();
});

function mount(enabled = true): ReactTestRenderer {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  openAccountLifetime("recipe-reader");
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(Probe, { enabled }),
      ),
    );
  });
  mounted.push(tree);
  return tree;
}

/** The tab, hidden, and how it is shown again. */
function hiddenTab() {
  const listeners = new Set<() => void>();
  const page = {
    visibilityState: "hidden" as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("document", page);
  return () =>
    act(() => {
      page.visibilityState = "visible";
      for (const listener of listeners) listener();
    });
}

describe("useZeropsGroupRecipe, from HQ's stream", () => {
  it.each<{ readonly said: Exclude<Said, "unsaid">; readonly state: GroupRecipe["state"] }>([
    { said: "absent", state: "absent" },
    { said: "recipe", state: "present" },
    // HQ holds a tier this build finds no service in: nothing a Mate could be made from.
    { said: "unusable", state: "unreadable" },
    { said: "failed", state: "unreadable" },
  ])("says a Mate tier HQ's stream says $said as $state, reading nothing", ({ said, state }) => {
    mount();
    expect(seen()).toMatchObject({ state: "loading", loading: true });
    say(null);
    expect(seen()).toMatchObject({ state: "loading", loading: true });
    say(said);
    expect(seen()).toMatchObject({ state, loading: false });
    expect(seen().tier === undefined).toBe(state !== "present");
    expect(hq.reads).toEqual([]);
  });

  it("hands over the recipe's tier as main holds it, and its services", () => {
    // The creation's plan converts it: what goes in when depends on whether there is a Mate.
    say("recipe");
    mount();
    expect(seen().tier).toEqual({ kind: "tier", tier: "mate", yaml: RECIPE });
    expect(seen().services).toEqual(["db"]);
  });

  it("tries again through HQ's stream, keeping what it said until the snapshot lands", () => {
    say("failed");
    mount();
    act(() => {
      seen().reread();
    });
    expect(snapshots).toEqual(["org-1"]);
    expect(seen()).toMatchObject({ state: "unreadable", rereading: true });
    say("recipe");
    expect(seen()).toMatchObject({ state: "present", rereading: false });
  });
});

describe("useZeropsGroupRecipe, where the stream carries no Mate tier", () => {
  it.each<{
    readonly main: RecipeTierResponse | "fails";
    readonly state: GroupRecipe["state"];
  }>([
    { main: PRESENT, state: "present" },
    { main: ABSENT, state: "absent" },
    { main: "fails", state: "unreadable" },
  ])("reads it on its own, once: $state", async ({ main, state }) => {
    say("unsaid");
    mount();
    expect(hq.reads).toHaveLength(1);
    expect(seen()).toMatchObject({ state: "loading", loading: true, tier: undefined });
    await answer(main);
    expect(seen()).toMatchObject({ state, loading: false });
    expect(hq.reads).toEqual([]);
  });

  it("reads nothing while the dialog is closed", () => {
    say("unsaid");
    mount(false);
    expect(hq.reads).toEqual([]);
    expect(seen().state).toBe("loading");
  });

  it("waits for a hidden tab to be shown before it reads", async () => {
    const show = hiddenTab();
    say("unsaid");
    mount();
    expect(hq.reads).toEqual([]);
    show();
    expect(hq.reads).toHaveLength(1);
    await answer(PRESENT);
    expect(seen().state).toBe("present");
  });

  it("tries again with a read of its own, not a snapshot that would carry none", async () => {
    say("unsaid");
    mount();
    await answer("fails");
    act(() => {
      seen().reread();
    });
    expect(snapshots).toEqual([]);
    expect(seen()).toMatchObject({ state: "unreadable", rereading: true });
    await answer(PRESENT);
    expect(seen()).toMatchObject({ state: "present", rereading: false });
  });

  it("opened again, says what it read last and acts on nothing until it has read anew", async () => {
    say("unsaid");
    const first = mount();
    await answer(PRESENT);
    act(() => {
      first.unmount();
    });
    mounted.splice(0);
    mount();
    expect(seen()).toMatchObject({ state: "present", loading: true, tier: undefined });
    await answer(ABSENT);
    expect(seen()).toMatchObject({ state: "absent", loading: false });
  });
});

// 0.13.2's rule: a remembered answer is said, not acted on — what is imported comes from a read.
describe("useZeropsGroupRecipe, while HQ's stream is down", () => {
  it("reads the Mate tier afresh, saying the last streamed one meanwhile without handing it over", async () => {
    say("recipe", "down");
    mount();
    expect(hq.reads).toHaveLength(1);
    expect(seen()).toMatchObject({ state: "present", loading: true, tier: undefined });
    await answer(PRESENT);
    expect(seen()).toMatchObject({ state: "present", loading: false });
    expect(seen().tier).toEqual({ kind: "tier", tier: "mate", yaml: RECIPE });
  });

  it("shuts the door where that read fails, and the stream's return opens it again", async () => {
    say("recipe", "down");
    mount();
    await answer("fails");
    expect(seen()).toMatchObject({ state: "unreadable", loading: false });
    say("recipe");
    expect(seen()).toMatchObject({ state: "present", loading: false });
    expect(hq.reads).toEqual([]);
  });
});
