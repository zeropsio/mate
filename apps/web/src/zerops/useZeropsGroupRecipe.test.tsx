/**
 * The tier a creation starts from, as the application's HQ detail says it: loading until HQ said
 * the tier, unreadable where HQ cannot read it or its read ended without the tier.
 */
import type { HqAppDetailRead } from "@t3tools/client-runtime/data";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { heldRecipeState, useZeropsGroupRecipe, type GroupRecipe } from "./useZeropsGroupRecipe";

const SHA = "a".repeat(40);
const YAML = "services:\n  - hostname: api\n    type: nodejs@22\n";
const NOT_READ: HqAppDetailRead = {
  releases: undefined,
  repos: undefined,
  changes: undefined,
  recipes: {},
  read: "reading",
  failure: null,
  live: false,
  reconnecting: false,
};
const held = { detail: NOT_READ, asked: [] as Array<unknown> };

let tree: ReactTestRenderer | undefined;
let seen: GroupRecipe | undefined;
function Probe({ enabled }: { readonly enabled: boolean }) {
  seen = useZeropsGroupRecipe({ appId: "shop", tier: "stage", enabled });
  return null;
}
const render = async (detail: HqAppDetailRead, enabled = true) => {
  held.detail = detail;
  await act(async () => {
    tree = create(createElement(Probe, { enabled }));
  });
  return seen!;
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  held.asked = [];
  const details = await import("./useHqAppDetail");
  const account = await import("./ZeropsAccountData");
  vi.spyOn(details, "useHqAppDetail").mockImplementation((appId) => {
    held.asked.push(appId);
    return held.detail;
  });
  vi.spyOn(account, "useAccountDataOptional").mockReturnValue(null);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useZeropsGroupRecipe", () => {
  it.each([
    { name: "HQ has not said the tier yet", detail: NOT_READ, state: "loading" },
    {
      name: "HQ's read ended without the tier",
      detail: { ...NOT_READ, read: "read" as const },
      state: "unreadable",
    },
    {
      name: "HQ cannot read the application",
      detail: { ...NOT_READ, failure: { code: "forbidden", message: "app_unreadable" } },
      state: "unreadable",
    },
    {
      name: "HQ says main has no such tier",
      detail: { ...NOT_READ, recipes: { stage: { state: "absent" as const } } },
      state: "absent",
    },
    {
      name: "HQ says the tier",
      detail: {
        ...NOT_READ,
        recipes: { stage: { state: "present" as const, importYaml: YAML, mainHead: SHA } },
      },
      state: "present",
    },
  ])("$name: $state", async ({ detail, state }) => {
    expect((await render(detail)).state).toBe(state);
  });

  it("holds the application's detail only while the creation asks", async () => {
    await render(NOT_READ, false);
    expect(held.asked).toEqual([null]);
  });

  it("retains the recipe revision the person chose for a later birth continuation", async () => {
    const recipe = await render({
      ...NOT_READ,
      recipes: { stage: { state: "present", importYaml: YAML, mainHead: SHA } },
    });
    expect(recipe.tier).toMatchObject({ tier: "stage", revision: SHA });
  });
});

describe("a held read of the setup files, for a gate before the press", () => {
  const READ: HqAppDetailRead = {
    ...NOT_READ,
    read: "read",
    live: true,
    recipes: { mate: { state: "absent" } },
  };
  it.each([
    {
      sentence: "A live read with no setup files on main says they are absent",
      read: READ,
      state: "absent",
    },
    {
      sentence:
        "A read paused since the setup was merged elsewhere answers nothing: Add a Mate stays on",
      read: { ...READ, live: false },
      state: "loading",
    },
    {
      sentence: "A read catching up answers nothing until it is live again",
      read: { ...READ, reconnecting: true },
      state: "loading",
    },
  ] as const)("$sentence", ({ read, state }) => {
    expect(heldRecipeState(read, "mate")).toBe(state);
  });
});
