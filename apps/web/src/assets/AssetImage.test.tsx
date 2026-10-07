import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { mateImageSource } from "@t3tools/client-runtime/data";
import { act, useRef } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const image = vi.hoisted(() => ({ keys: [] as unknown[] }));
vi.mock("./MateImages", () => ({
  useMateImage: (key: unknown) => {
    image.keys.push(key);
    return { read: { kind: "ready" }, url: "blob:preview", retry: () => {} };
  },
}));
vi.mock("../hooks/useNearViewport", () => ({
  useNearViewport: () => ({ ref: useRef(null), near: true }),
}));
import { AssetImage } from "./AssetImage";

afterEach(() => vi.unstubAllGlobals());
it("measures the drawn image itself and keeps authorized pixels in its reserved tile", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  const observed: string[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(element: { tag: string }) {
        observed.push(element.tag);
      }
      disconnect() {}
    },
  );
  const source = mateImageSource({
    environmentId: EnvironmentId.make("mate"),
    resource: { _tag: "media-file", threadId: ThreadId.make("thread"), path: "mate-asset:picture" },
  });
  image.keys = [];
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<AssetImage src={source} alt="The checked page" />, {
      createNodeMock: (element) => ({
        tag: element.type,
        getBoundingClientRect: () => ({ width: 120, height: 80 }),
        parentElement: { getBoundingClientRect: () => ({ width: 120, height: 80 }) },
      }),
    });
  });
  expect(observed).toEqual(["img"]);
  expect(image.keys.at(-1)).toMatchObject({ rendition: { width: 240, height: 160 } });
  expect(renderer.root.findByType("img").props.src).toBe("blob:preview");
  expect(renderer.root.findByType("img").props["data-image-src"]).toBe(source);
  act(() => renderer.unmount());
});
