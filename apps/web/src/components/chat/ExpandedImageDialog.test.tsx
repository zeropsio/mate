import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { mateImageSource } from "@t3tools/client-runtime/data";
import { act, type ImgHTMLAttributes, type ReactNode } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const reads = vi.hoisted(() => ({ keys: [] as unknown[] }));
vi.mock("~/assets/MateImages", () => ({
  useMateImage: (key: unknown) => {
    reads.keys.push(key);
    return {
      read: { kind: "ready", occurrence: { name: "retained-original.png" } },
      url: "blob:original",
    };
  },
}));
vi.mock("~/assets/AssetImage", () => ({
  AssetImage: ({
    original,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { original?: boolean }) => (
    <img {...props} data-original={original} />
  ),
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
import { ExpandedImageDialog } from "./ExpandedImageDialog";

afterEach(() => vi.unstubAllGlobals());
it("a gallery reference zooms the original and downloads its authorized bytes with its retained name", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("window", {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const source = mateImageSource({
    environmentId: EnvironmentId.make("mate"),
    resource: {
      _tag: "media-file",
      threadId: ThreadId.make("thread"),
      path: "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    },
  });
  reads.keys = [];
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <ExpandedImageDialog
        preview={{ index: 0, images: [{ src: source, name: "Drawn shot" }] }}
        onClose={() => {}}
      />,
      {
        createNodeMock: () => ({
          clientWidth: 500,
          clientHeight: 400,
          scrollLeft: 0,
          scrollTop: 0,
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
      },
    );
  });
  expect(reads.keys.at(-1)).toMatchObject({
    rendition: "original",
    resource: { path: "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  });
  const picture = renderer.root.findByType("img");
  expect(picture.props.src).toBe(source);
  expect(picture.props["data-original"]).toBe(true);
  act(() => {
    picture.props.onLoad({ currentTarget: { naturalWidth: 1440, naturalHeight: 1100 } });
  });
  const before = renderer.root.findByType("img").props.style.width;
  act(() => {
    renderer.root
      .findByProps({ role: "region" })
      .props.onClick({ detail: 1, clientX: 200, clientY: 200 });
  });
  expect(renderer.root.findByType("img").props.style.width).toBe(before * 2);
  expect(renderer.root.findByType("img").props["data-original"]).toBe(true);
  expect(renderer.root.findByType("a").props).toMatchObject({
    href: "blob:original",
    download: "retained-original.png",
  });
  act(() => renderer.unmount());
});
