import { EnvironmentId } from "@t3tools/contracts";
import { mateImageSource } from "@t3tools/client-runtime/data";
import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
const image = vi.hoisted(() => ({
  key: null as unknown,
  ready: false,
  name: undefined as string | undefined,
}));
vi.mock("./MateImages", () => ({
  useMateImage: (key: unknown) => {
    image.key = key;
    return {
      read: {
        kind: image.ready ? "ready" : "reading",
        ...(image.name === undefined ? {} : { occurrence: { name: image.name } }),
      },
      url: image.ready ? "blob:original" : undefined,
      retry: () => {},
    };
  },
}));
import { AssetDownloadLink } from "./AssetDownloadLink";
afterEach(() => vi.unstubAllGlobals());
it.each([
  { originalName: "photo.png", displayName: "photo.jpg" },
  { originalName: undefined, displayName: "photo.jpg" },
])(
  "downloads the original name by reference only after the person clicks: $originalName",
  ({ originalName, displayName }) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const click = vi.fn();
    const link = { href: "", download: "", click };
    vi.stubGlobal("document", { createElement: () => link });
    image.ready = false;
    image.name = originalName;
    const source = mateImageSource({
      environmentId: EnvironmentId.make("mate"),
      resource: { _tag: "attachment", attachmentId: "photo", occurrenceId: "occurrence" },
    });
    const view = (
      <AssetDownloadLink source={source} download={displayName}>
        Download
      </AssetDownloadLink>
    );
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(view);
    });
    expect(image.key).toBeNull();
    const stopPropagation = vi.fn();
    act(() =>
      renderer.root
        .findByType("a")
        .props.onClick({ defaultPrevented: false, preventDefault: () => {}, stopPropagation }),
    );
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(image.key).toMatchObject({ rendition: "original" });
    expect(click).not.toHaveBeenCalled();
    image.ready = true;
    act(() =>
      renderer.update(
        <AssetDownloadLink source={source} download={displayName}>
          Download
        </AssetDownloadLink>,
      ),
    );
    expect(link).toMatchObject({ href: "blob:original", download: originalName ?? displayName });
    expect(click).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  },
);
