import { EnvironmentId, type AssetResource } from "@t3tools/contracts";
import { mateImageSource } from "@t3tools/client-runtime/data";
import { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vite-plus/test";
const state = vi.hoisted(() => ({ url: undefined as string | undefined, demand: null as unknown }));
vi.mock("~/assets/MateImages", () => ({
  useMateImage: (key: unknown) => {
    state.demand = key;
    return { url: state.url };
  },
}));
vi.mock("../assets/assetUrls", async () => {
  const { mateImageSource } = await import("@t3tools/client-runtime/data");
  return {
    useAssetUrlState: (environmentId: EnvironmentId, resource: AssetResource) => ({
      _tag: "Success",
      url: mateImageSource({ environmentId, resource }),
    }),
  };
});
import { ProjectFavicon } from "./ProjectFavicon";
beforeEach(() => {
  state.url = undefined;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
it.each([undefined, "blob:favicon"])(
  "uses the projected favicon bytes or the existing folder fallback: %s",
  (url) => {
    state.url = url;
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ProjectFavicon
          environmentId={EnvironmentId.make("mate")}
          cwd="/workspace"
          faviconPath=".zerops/favicon.png"
        />,
      );
    });
    expect(state.demand).toMatchObject({
      environmentId: "mate",
      resource: { _tag: "project-favicon", cwd: "/workspace", path: ".zerops/favicon.png" },
    });
    expect(renderer.root.findAllByType("img")).toHaveLength(url ? 1 : 0);
    if (url) expect(renderer.root.findByType("img").props.src).toBe(url);
    expect(
      mateImageSource({
        environmentId: EnvironmentId.make("mate"),
        resource: { _tag: "project-favicon", cwd: "/workspace" },
      }),
    ).not.toContain("blob:");
    act(() => renderer.unmount());
  },
);

it("a favicon that cannot be displayed returns to its folder without conversation failure controls", () => {
  state.url = "blob:missing-favicon";
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <ProjectFavicon environmentId={EnvironmentId.make("mate")} cwd="/workspace" />,
    );
  });
  act(() => renderer.root.findByType("img").props.onError({}));
  expect(renderer.root.findAllByType("img")).toHaveLength(0);
  expect(renderer.root.findAllByType("button")).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Image unavailable");
  state.url = "blob:replacement-favicon";
  act(() =>
    renderer.update(<ProjectFavicon environmentId={EnvironmentId.make("mate")} cwd="/workspace" />),
  );
  expect(renderer.root.findByType("img").props.src).toBe(state.url);
  act(() => renderer.unmount());
});
