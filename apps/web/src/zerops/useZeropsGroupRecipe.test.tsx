/**
 * The tier a creation starts from, as the application's HQ detail says it: loading until HQ said
 * the tier, unreadable where HQ cannot read it or its read ended without the tier.
 */
import type { HqAppDetailRead } from "@t3tools/client-runtime/data";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsGroupRecipe, type GroupRecipe } from "./useZeropsGroupRecipe";

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
const held = vi.hoisted(() => ({ detail: undefined as unknown, asked: [] as Array<unknown> }));
vi.mock("./useHqAppDetail", () => ({
  useHqAppDetail: (appId: string | null) => {
    held.asked.push(appId);
    return held.detail;
  },
}));
vi.mock("../state/zerops", () => ({
  hqNavigationAtom: {},
  hqDown: () => false,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({}) }));
vi.mock("./ZeropsAccountData", () => ({ useAccountDataOptional: () => null }));

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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  held.asked = [];
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
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
      detail: { ...NOT_READ, failure: "app_unreadable" },
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
});
