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

it("a reserved picture hides browser fallback until decoding finishes", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let decoded!: () => void;
  const decoding = new Promise<void>((resolve) => {
    decoded = resolve;
  });
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <AssetImage src="https://image.test/shot.png" alt="Picture 2" width={640} height={320} />,
      {
        createNodeMock: () => ({ decode: () => decoding }),
      },
    );
  });
  expect(renderer.root.findByType("img").props.style.opacity).toBe(0);
  await act(async () => {
    decoded();
    await decoding;
  });
  expect(renderer.root.findByType("img").props.style.opacity).toBe(1);
  act(() => renderer.unmount());
});

it("a failed picture explains the failure and retries on request", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <AssetImage src="https://image.test/missing.png" alt="Picture 3" width={640} height={320} />,
    );
  });
  act(() => renderer.root.findByType("img").props.onError({}));
  expect(renderer.root.findAllByType("img")).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("Image unavailable");
  const retry = renderer.root.findByType("button");
  expect(retry.children).toEqual(["Try again"]);
  act(() => retry.props.onClick({ stopPropagation() {} }));
  expect(renderer.root.findByType("img").props.src).toBe("https://image.test/missing.png");
  act(() => renderer.unmount());
});
