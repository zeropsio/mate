import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { mateImageSource } from "@t3tools/client-runtime/data";
import { act, useRef } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const image = vi.hoisted(() => ({
  keys: [] as unknown[],
  near: true,
  failure: null as null | { reason: string; retryable: boolean },
}));
vi.mock("./MateImages", () => ({
  useMateImage: (key: unknown) => {
    image.keys.push(key);
    if (key && typeof key === "object" && "rendition" in key && key.rendition === "original")
      return {
        read: { kind: "reading" },
        url: "blob:preview",
        previewUrl: "blob:preview",
        originalUrl: undefined,
        loadingOriginal: true,
        retry: () => {},
      };
    return image.failure
      ? { read: { kind: "failed", ...image.failure }, retry: () => {} }
      : {
          read: { kind: "ready" },
          url: "blob:preview",
          originalUrl: "blob:preview",
          retry: () => {},
        };
  },
}));
vi.mock("../hooks/useNearViewport", () => ({
  useNearViewport: () => ({ ref: useRef(null), near: image.near }),
}));
import { AssetImage } from "./AssetImage";

afterEach(() => {
  vi.unstubAllGlobals();
  image.failure = null;
  image.near = true;
});
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

it("hiding and moving a decoded picture keeps its rendition until it has a drawn size again", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  let measure!: () => void;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const source = mateImageSource({
    environmentId: EnvironmentId.make("mate"),
    resource: { _tag: "media-file", threadId: ThreadId.make("thread"), path: "mate-asset:picture" },
  });
  let box = { width: 120, height: 80 };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<AssetImage src={source} alt="The moving picture" />, {
      createNodeMock: () => ({
        getBoundingClientRect: () => box,
        parentElement: { getBoundingClientRect: () => box },
      }),
    });
  });
  const held = image.keys.at(-1);
  for (const hidden of [
    { width: 0, height: 0 },
    { width: 120, height: 0 },
    { width: 120, height: 80 },
  ]) {
    box = hidden;
    act(measure);
    expect(image.keys.at(-1)).toEqual(held);
  }
  box = { width: 240, height: 160 };
  act(measure);
  expect(image.keys.at(-1)).toMatchObject({ rendition: box });
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

it.each([
  { reason: "Image no longer available", retryable: false },
  { reason: "Mate is unreachable.", retryable: true },
])(
  "shows one failure line and retry only for a recoverable image: $reason",
  ({ reason, retryable }) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    image.failure = { reason, retryable };
    const src = mateImageSource({
      environmentId: EnvironmentId.make("mate"),
      resource: {
        _tag: "workspace-file",
        threadId: ThreadId.make("thread"),
        path: "mate-asset:shot",
      },
    });
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<AssetImage src={src} width={640} height={320} />);
    });
    const content = JSON.stringify(renderer.toJSON());
    expect(content.split(reason)).toHaveLength(2);
    expect(content).not.toContain('"Image unavailable"');
    expect(renderer.root.findAllByType("button")).toHaveLength(retryable ? 1 : 0);
    act(() => renderer.unmount());
  },
);

it("the selected original shows its retained preview before viewport observation", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  image.near = false;
  const src = mateImageSource({
    environmentId: EnvironmentId.make("mate"),
    resource: {
      _tag: "workspace-file",
      threadId: ThreadId.make("thread"),
      path: "mate-asset:shot",
    },
  });
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<AssetImage src={src} original width={640} height={400} />);
  });
  expect(renderer.root.findByProps({ "aria-hidden": true }).props.src).toBe("blob:preview");
  act(() => renderer.unmount());
});
