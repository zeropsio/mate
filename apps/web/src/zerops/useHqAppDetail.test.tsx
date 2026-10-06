/**
 * A surface over several applications holds each one's HQ detail while it draws it: an application
 * joining or leaving takes or lets go of its own hold only, never the others'.
 */
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useHqAppReleases } from "./useHqAppDetail";

const holds = vi.hoisted(() => ({
  /** Each hold held now, as `family owner`. */
  held: [] as Array<string>,
  /** Every hold taken, in order. */
  taken: [] as Array<string>,
}));
vi.mock("./ZeropsAccountData", () => {
  const data = {
    orgId: "org-1",
    demandDetail: (demand: { readonly family: string; readonly ownerId: string }) => {
      const name = `${demand.family} ${demand.ownerId}`;
      holds.held.push(name);
      holds.taken.push(name);
      return () => void holds.held.splice(holds.held.indexOf(name), 1);
    },
  };
  return {
    useAccountDataOptional: () => data,
    useAccountOrgId: () => data.orgId,
    useProjection: () => ({}),
  };
});

function Probe({ appIds }: { readonly appIds: ReadonlyArray<string> }) {
  useHqAppReleases(appIds);
  return null;
}

let tree: ReactTestRenderer | undefined;
const render = async (appIds: ReadonlyArray<string>) => {
  await act(async () => {
    if (tree === undefined) tree = create(createElement(Probe, { appIds }));
    else tree.update(createElement(Probe, { appIds }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  holds.held = [];
  holds.taken = [];
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("useHqAppReleases", () => {
  it("holds each drawn application's detail, taking and letting go only its own", async () => {
    await render(["shop"]);
    await render(["shop", "blog"]);
    await render(["blog"]);
    expect(holds.taken).toEqual(["hqAppDetail shop", "hqAppDetail blog"]);
    expect(holds.held).toEqual(["hqAppDetail blog"]);

    await act(async () => tree?.unmount());
    tree = undefined;
    expect(holds.held).toEqual([]);
  });
});
