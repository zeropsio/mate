// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SETTLE_MS, warmAppChunksAfterSettling } from "../lib/appChunks";
import { ZeropsReviewProvider } from "./ZeropsReviewProvider";
import { useOpenReview } from "./review";

vi.mock("../components/zerops/review/ZeropsChangeReview", () => ({
  ZeropsChangeReview: () => <p>Shop Front #3</p>,
}));

function Door() {
  const open = useOpenReview();
  return (
    <button
      onClick={() => open({ kind: "change", groupId: "acme", repository: "shop", number: 3 })}
    >
      Review
    </button>
  );
}

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The page is idle at once.
  vi.stubGlobal("requestIdleCallback", (run: () => void) => {
    run();
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", () => undefined);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// A run 2 follow-up: the review's code was fetched on the press, and the dialog stood blank with
// only its × for 0.3 s.
describe("the review's code", () => {
  it("is fetched while the page is idle, so the first Review draws the review in its first frame", async () => {
    await act(async () => {
      root.render(
        <ZeropsReviewProvider>
          <Door />
        </ZeropsReviewProvider>,
      );
      // The page settles, and the app's warmer fetches the review's code.
      warmAppChunksAfterSettling([]);
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    });
    act(() => {
      document.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Shop Front #3");
  });
});
