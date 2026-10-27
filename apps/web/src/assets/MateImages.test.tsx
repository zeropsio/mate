import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import {
  makeAccountStore,
  mateImageId,
  mateImageScope,
  mateImageReferenceId,
  mateImageSource,
  type MateImageKey,
} from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import { act, useRef } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
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
vi.mock("../hooks/useNearViewport", () => ({
  useNearViewport: () => ({ ref: useRef(null), near: true }),
}));
import { AssetImage } from "./AssetImage";
import { imagePresentationsOf } from "./imagePresentation";
import { MateImages } from "./MateImagesProvider";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("a remounted decoded image paints its retained pixels immediately and releases them with the account", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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
        value: {
          blob: wire.blob,
          digest: "digest",
          reference: mateImageReferenceId(key),
          dimensions: { width: 80, height: 40 },
        },
        revision: { kind: "mate-link", sequence: 1 },
      },
    ],
  });
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const decode = vi.fn(() => Promise.resolve());
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = decode;
    },
  );
  const frames: { src: unknown; opacity: number }[] = [];
  const tree = (show: boolean) => (
    <RegistryContext.Provider value={registry}>
      <MateImages store={store}>
        {show ? <AssetImage src={mateImageSource(key)} alt="Picture" /> : null}
      </MateImages>
    </RegistryContext.Provider>
  );
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(tree(true), {
      createNodeMock: (element) => {
        if (element.type === "img") {
          const props = element.props as { src?: string; style: { opacity: number } };
          frames.push({ src: props.src, opacity: props.style.opacity });
        }
        return {
          decode,
          getBoundingClientRect: () => ({ width: 80, height: 40 }),
          parentElement: { getBoundingClientRect: () => ({ width: 80, height: 40 }) },
        };
      },
    });
  });
  expect(decode).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType("img").props.style.opacity).toBe(1);
  act(() => renderer.update(tree(false)));
  expect(revokeUrl).not.toHaveBeenCalled();
  act(() => renderer.update(tree(true)));
  expect(frames.at(-1)).toEqual({ src: "blob:test", opacity: 1 });
  expect(renderer.root.findByType("img").props.style.opacity).toBe(1);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(createUrl).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
  expect(revokeUrl).not.toHaveBeenCalled();
  store.close();
  expect(revokeUrl).toHaveBeenCalledWith("blob:test");
  registry.dispose();
});

it("withdrawing access removes retained browser pixels and a new grant must decode again", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const presentations = imagePresentationsOf(store);
  const env = EnvironmentId.make("mate");
  vi.spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:first")
    .mockReturnValueOnce("blob:renewed");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const blob = wire.blob;
  const held = presentations.get(env, blob, "same-digest");
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = () => Promise.resolve();
    },
  );
  await held.decode();
  const pixels = held.pixels;
  expect(presentations.get(env, new Blob(["picture"]), "same-digest")).toBe(held);
  expect(held.pixels).toBe(pixels);
  presentations.release(env);
  expect(held.decoded).toBe(false);
  expect(held.pixels).toBeUndefined();
  expect(revoke).toHaveBeenCalledWith("blob:first");
  const renewed = presentations.get(env, blob, "same-digest");
  expect(renewed.url).toBe("blob:renewed");
  expect(renewed.decoded).toBe(false);
  store.close();
  registry.dispose();
});
