import { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vite-plus/test";

import { AssetImage } from "./AssetImage";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

it("shows unavailable after a byte request or decode fails, without retrying", () => {
  const onError = vi.fn();
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <AssetImage src="https://mate.test/shot.png" alt="Screenshot" onError={onError} />,
    );
  });
  act(() => renderer.root.findByType("img").props.onError({ currentTarget: {} }));
  expect(onError).toHaveBeenCalledOnce();
  expect(JSON.stringify(renderer.toJSON())).toContain("Image unavailable");
  expect(renderer.root.findAllByType("img")).toHaveLength(0);
  act(() => renderer.update(<AssetImage src="https://mate.test/new.png" alt="Screenshot" />));
  expect(renderer.root.findByType("img").props.src).toBe("https://mate.test/new.png");
  act(() => renderer.unmount());
});
