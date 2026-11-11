import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { mateImageSource } from "@t3tools/client-runtime/data";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { act, type ReactNode } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const reads = { keys: [] as unknown[] };
import { ExpandedImageDialog } from "./ExpandedImageDialog";
import { useEditPictureInExpress } from "../express/useOpenExpressDesign";

const drawn: Array<ReturnType<typeof create>> = [];
beforeEach(async () => {
  reads.keys = [];
  const images = await import("~/assets/MateImages");
  const asset = await import("~/assets/AssetImage");
  const buttons = await import("../ui/button");
  const dialog = await import("../ui/dialog");
  vi.spyOn(images, "useImageIntent").mockReturnValue(
    {} as ReturnType<typeof images.useImageIntent>,
  );
  vi.spyOn(images, "useMateImage").mockImplementation((key) => {
    reads.keys.push(key);
    return {
      read: { kind: "ready", occurrence: { name: "retained-original.png" } },
      url: "blob:original",
    } as unknown as ReturnType<typeof images.useMateImage>;
  });
  vi.spyOn(asset, "AssetImage").mockImplementation((({ original, ...props }) => (
    <img {...props} data-original={original} />
  )) as typeof asset.AssetImage);
  vi.spyOn(buttons, "Button").mockImplementation((({
    children,
    ...props
  }: {
    children: ReactNode;
  }) => <button {...props}>{children}</button>) as typeof buttons.Button);
  // The kit's dialog portals out of the tree this renderer draws: here it is its children.
  vi.spyOn(dialog, "Dialog").mockImplementation(
    (({ children }: { children: ReactNode }) => children) as typeof dialog.Dialog,
  );
  vi.spyOn(dialog, "DialogMediaPopup").mockImplementation((({
    children,
  }: {
    children: ReactNode;
  }) => <div>{children}</div>) as typeof dialog.DialogMediaPopup);
});

afterEach(() => {
  act(() => {
    for (const renderer of drawn.splice(0)) renderer.unmount();
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
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
  drawn.push(renderer);
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
});

function PictureWithExpress({ enabled, src }: { readonly enabled: boolean; readonly src: string }) {
  const edit = useEditPictureInExpress(
    scopeThreadRef(EnvironmentId.make("mate"), ThreadId.make("thread")),
    enabled,
  );
  return (
    <ExpandedImageDialog
      preview={{ index: 0, images: [{ src, name: "Drawn shot" }] }}
      onClose={() => {}}
      onEditInExpress={edit}
    />
  );
}

it.each([
  { title: "the picture viewer offers Edit in Adobe Express while Express is on", enabled: true },
  { title: "the picture viewer offers no Adobe Express while Express is off", enabled: false },
])("$title", ({ enabled }) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("window", {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const src = mateImageSource({
    environmentId: EnvironmentId.make("mate"),
    resource: {
      _tag: "media-file",
      threadId: ThreadId.make("thread"),
      path: "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    },
  });
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<PictureWithExpress enabled={enabled} src={src} />, {
      createNodeMock: () => ({
        clientWidth: 500,
        clientHeight: 400,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });
  drawn.push(renderer);
  expect(JSON.stringify(renderer.toJSON()).includes("Edit in Adobe Express")).toBe(enabled);
});
