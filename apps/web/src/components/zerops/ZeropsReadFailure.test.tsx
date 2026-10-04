import { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { ZeropsReadFailure } from "./ZeropsReadFailure";

describe("a failed read's manual action", () => {
  it.each(["Compare again", "Read recipe again"] as const)(
    "says why and offers %s once per press",
    (action) => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const again = vi.fn();
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <ZeropsReadFailure action={action} again={again} reason="HQ could not answer." />,
        );
      });
      expect(JSON.stringify(tree.toJSON())).toContain("HQ could not answer.");
      const button = tree.root.findByType("button");
      expect(button.children).toContain(action);
      expect(again).not.toHaveBeenCalled();
      act(() => {
        button.props.onClick();
      });
      expect(again).toHaveBeenCalledOnce();
      act(() => {
        tree.unmount();
      });
    },
  );
});
