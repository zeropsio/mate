import { RegistryContext } from "@effect/atom-react";
import { makeAccountStore, pictureId, pictureScope } from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  useProjectedHqPicture,
  type ChangePictureSource,
  type ChangePictureState,
} from "./useProjectedHqPicture";

let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("demands unread bytes only near the viewport, keeps cached bytes and releases browser resources", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picture");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const key = { orgId: "org", link: { appId: "app", repo: "web", number: 1, id: "picture" } };
  const release = vi.fn();
  const demand = vi.fn(() => release);
  const source: ChangePictureSource = { data: store.data, key: () => key, demand };
  const states: ChangePictureState[] = [];
  function Probe({ visible }: { readonly visible: boolean }) {
    states.push(useProjectedHqPicture(source, "picture", visible));
    return null;
  }
  const view = (visible: boolean) =>
    createElement(RegistryContext, { value: registry }, createElement(Probe, { visible }));
  await act(async () => {
    tree = create(view(false));
  });
  expect(demand).not.toHaveBeenCalled();
  expect(createUrl).not.toHaveBeenCalled();
  expect(states.at(-1)?.kind).toBe("reading");
  await act(async () => {
    tree?.update(view(true));
  });
  expect(demand).toHaveBeenCalledTimes(1);
  const blob = new Blob(["picture"], { type: "image/png" });
  await act(async () => {
    store.dispatch({
      kind: "baseline-commit",
      scope: pictureScope(key),
      generation: 0,
      via: "hq-stream",
      members: [pictureId(key)],
      rows: [
        {
          family: "hqPicture",
          id: pictureId(key),
          value: blob,
          revision: { kind: "hq", incarnation: pictureId(key), revision: 0 },
        },
      ],
    });
  });
  expect(states.at(-1)).toEqual({ kind: "read", src: "blob:picture" });
  expect(createUrl).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree?.update(view(false));
  });
  expect(release).toHaveBeenCalledTimes(1);
  expect(states.at(-1)).toEqual({ kind: "read", src: "blob:picture" });
  expect(demand).toHaveBeenCalledTimes(1);
  await act(async () => tree?.unmount());
  tree = undefined;
  expect(revokeUrl).toHaveBeenCalledWith("blob:picture");
});
