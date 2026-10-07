// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { ReleaseAction } from "./ZeropsReleaseVerb";

describe("the release review door", () => {
  it.each([
    { offered: false, releasing: false, shown: false },
    { offered: true, releasing: false, shown: true },
    { offered: false, releasing: true, shown: true },
  ])("offered=$offered, releasing=$releasing", async ({ offered, releasing, shown }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onReview = vi.fn();
    try {
      await act(async () => {
        root.render(
          <ReleaseAction
            label="Review release"
            release={{ offered, releasing, tag: undefined, reason: undefined, onReview }}
          />,
        );
      });
      const button = container.querySelector("button");
      expect(button !== null).toBe(shown);
      expect(onReview).not.toHaveBeenCalled();
      if (button !== null) {
        if (!releasing) expect(button.textContent).toBe("Review release");
        await act(async () => button.click());
        expect(onReview).toHaveBeenCalledExactlyOnceWith(button);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
