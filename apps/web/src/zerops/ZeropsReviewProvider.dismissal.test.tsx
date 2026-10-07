// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ZeropsReviewProvider } from "./ZeropsReviewProvider";
import { useOpenReview } from "./review";

// The person's exit is available even before a lazy review body arrives.
vi.mock("../components/zerops/review/ZeropsReleaseReview", () => new Promise(() => {}));
function Door({ revision }: { revision: number }) {
  const open = useOpenReview();
  return (
    <button onClick={() => open({ kind: "release", groupId: "rig" })}>Review {revision}</button>
  );
}
const draw = (revision: number) => (
  <ZeropsReviewProvider>
    <Door revision={revision} />
  </ZeropsReviewProvider>
);
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the review opening while its body loads", () => {
  it.each(["X", "Escape", "outside"])(
    "closes with %s and another render does not reopen it",
    async (method) => {
      await act(() => root.render(draw(1)));
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      await act(() => {
        if (method === "X")
          document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
        else if (method === "Escape")
          dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else {
          const outside = document.querySelector(".rv-viewport")!;
          for (const type of ["mousedown", "mouseup", "click"])
            outside.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
        }
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => root.render(draw(2)));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    },
  );
});
