import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import {
  makeAccountStore,
  mateImageId,
  mateImageScope,
  type MateImageKey,
} from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
const wire = vi.hoisted(() => ({ blob: new Blob(["picture"], { type: "image/png" }) }));
vi.mock("~/connection/runtime", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const Effect = await import("effect/Effect");
  return {
    connectionAtomRuntime: {
      atom: () =>
        Atom.make(AsyncResult.success({ read: () => Effect.never, repair: () => Effect.void })),
    },
  };
});
import { useMateImage } from "./MateImages";
import { MateImages } from "./MateImagesProvider";
it("a mounted view revokes its Blob URL on release while the account retains the bytes", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const key: MateImageKey = {
    environmentId: EnvironmentId.make("mate"),
    resource: { _tag: "attachment", attachmentId: "photo" },
    rendition: { width: 80, height: 40 },
  };
  const scope = mateImageScope(key);
  store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 0,
    via: "mate-direct",
    members: [mateImageId(key)],
    rows: [
      {
        family: "mateImage",
        id: mateImageId(key),
        value: { blob: wire.blob },
        revision: { kind: "mate-link", sequence: 1 },
      },
    ],
  });
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  function View() {
    const image = useMateImage(key);
    return <span>{image.url}</span>;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <MateImages store={store}>
          <View />
        </MateImages>
      </RegistryContext.Provider>,
    );
  });
  expect(createUrl).toHaveBeenCalledWith(wire.blob);
  expect(renderer.root.findByType("span").children).toContain("blob:test");
  act(() => renderer.unmount());
  expect(revokeUrl).toHaveBeenCalledWith("blob:test");
  expect(store.state().facts.size).toBe(1);
  createUrl.mockRestore();
  revokeUrl.mockRestore();
  registry.dispose();
});
