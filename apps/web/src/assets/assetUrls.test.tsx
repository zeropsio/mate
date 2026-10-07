import { EnvironmentId } from "@t3tools/contracts";
import { parseMateImageSource } from "@t3tools/client-runtime/data";
import { act, useLayoutEffect } from "react";
import { create } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const queried = vi.hoisted(() => ({ resources: [] as unknown[], results: [] }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => queried.results }));
vi.mock("~/state/assets", () => ({
  assetEnvironment: {
    createUrls: ({ resources }: { resources: unknown[] }) => {
      queried.resources = resources;
      return {};
    },
  },
}));
vi.mock("~/state/session", () => ({ usePreparedConnection: () => ({ _tag: "None" }) }));
import { useAssetUrlStates, type AssetUrlState } from "./assetUrls";

it("conversation image identities do not fetch bytes or sign URLs before their view demands them", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const environmentId = EnvironmentId.make("mate");
  const resource = { _tag: "attachment" as const, attachmentId: "photo", mimeType: "image/png" };
  let states: ReadonlyArray<AssetUrlState> = [];
  function View() {
    states = useAssetUrlStates(environmentId, [resource]);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<View />);
  });
  expect(queried.resources).toEqual([]);
  expect(states[0]?._tag).toBe("Success");
  if (states[0]?._tag !== "Success") throw new Error("no reference");
  expect(parseMateImageSource(states[0].url)).toEqual({ environmentId, resource });
  act(() => renderer.unmount());
});

it("unchanged image identities do not publish another kept-timeline layout read", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onRead = vi.fn();
  function View({ tick }: { readonly tick: number }) {
    const states = useAssetUrlStates(EnvironmentId.make("mate"), [
      { _tag: "attachment", attachmentId: "photo", mimeType: "image/png" },
    ]);
    useLayoutEffect(() => onRead(states), [states]);
    return <span>{tick}</span>;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<View tick={0} />);
  });
  act(() => renderer.update(<View tick={1} />));
  expect(onRead).toHaveBeenCalledOnce();
  act(() => renderer.unmount());
});
