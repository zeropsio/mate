import { EnvironmentId } from "@t3tools/contracts";
import { mateImageSource } from "@t3tools/client-runtime/data";
import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
const image = vi.hoisted(() => ({ key: null as unknown, ready: false }));
vi.mock("./MateImages", () => ({
  useMateImage: (key: unknown) => {
    image.key = key;
    return {
      read: { kind: image.ready ? "ready" : "reading" },
      url: image.ready ? "blob:original" : undefined,
      retry: () => {},
    };
  },
}));
import { AssetDownloadLink } from "./AssetDownloadLink";
afterEach(() => vi.unstubAllGlobals());
it("downloads the original by reference only after the person clicks", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const click = vi.fn();
  const link = { href: "", download: "", click };
  vi.stubGlobal("document", { createElement: () => link });
  image.ready = false;
  const source = mateImageSource({
    environmentId: EnvironmentId.make("mate"),
    resource: { _tag: "attachment", attachmentId: "photo", occurrenceId: "occurrence" },
  });
  const view = (
    <AssetDownloadLink source={source} download="photo.png">
      Download
    </AssetDownloadLink>
  );
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(view);
  });
  expect(image.key).toBeNull();
  act(() =>
    renderer.root
      .findByType("a")
      .props.onClick({ defaultPrevented: false, preventDefault: () => {} }),
  );
  expect(image.key).toMatchObject({ rendition: "original" });
  expect(click).not.toHaveBeenCalled();
  image.ready = true;
  act(() =>
    renderer.update(
      <AssetDownloadLink source={source} download="photo.png">
        Download
      </AssetDownloadLink>,
    ),
  );
  expect(link).toMatchObject({ href: "blob:original", download: "photo.png" });
  expect(click).toHaveBeenCalledOnce();
  act(() => renderer.unmount());
});
