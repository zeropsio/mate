import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useHqMateRefusal } from "./useHqMateRefusal";

const state = vi.hoisted(() => ({
  account: null as {
    readonly orgId: string | null;
    readonly demandDetail: (request: {
      readonly family: string;
      readonly ownerId: string;
    }) => () => void;
  } | null,
}));
vi.mock("./ZeropsAccountData", () => ({
  useAccountDataOptional: () => state.account,
}));

let tree: ReactTestRenderer | undefined;
function Probe({ projectId }: { readonly projectId: string }) {
  useHqMateRefusal(projectId);
  return null;
}
async function render(projectId: string) {
  await act(async () => {
    const view = createElement(Probe, { projectId });
    if (tree === undefined) tree = create(view);
    else tree.update(view);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.account = null;
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

it("a direct Mate address holds only its HQ admission answer until it leaves", async () => {
  const released = [vi.fn(), vi.fn()];
  const demandDetail = vi.fn().mockReturnValueOnce(released[0]).mockReturnValueOnce(released[1]);
  state.account = { orgId: "org-a", demandDetail };
  await render("chief-a");
  await render("chief-a");
  expect(demandDetail.mock.calls).toEqual([[{ family: "hqMate", ownerId: "chief-a" }]]);
  await render("chief-b");
  expect(released[0]).toHaveBeenCalledOnce();
  expect(demandDetail).toHaveBeenLastCalledWith({ family: "hqMate", ownerId: "chief-b" });
  await act(async () => tree?.unmount());
  tree = undefined;
  expect(released[1]).toHaveBeenCalledOnce();
});

it("a direct Mate address moves its admission read when the account or organization changes", async () => {
  const firstRelease = vi.fn();
  const secondRelease = vi.fn();
  const thirdRelease = vi.fn();
  const firstDemand = vi.fn().mockReturnValue(firstRelease);
  const secondDemand = vi.fn().mockReturnValueOnce(secondRelease).mockReturnValueOnce(thirdRelease);
  state.account = { orgId: "org-a", demandDetail: firstDemand };
  await render("chief-a");
  state.account = { orgId: "org-a", demandDetail: secondDemand };
  await render("chief-a");
  expect(firstRelease).toHaveBeenCalledOnce();
  expect(secondDemand).toHaveBeenCalledOnce();
  state.account = { orgId: "org-b", demandDetail: secondDemand };
  await render("chief-a");
  expect(secondRelease).toHaveBeenCalledOnce();
  expect(secondDemand).toHaveBeenCalledTimes(2);
  state.account = null;
  await render("chief-a");
  expect(thirdRelease).toHaveBeenCalledOnce();
});
