// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { ZeropsNextStepStrip } from "./ZeropsNextStepBanner";

const merge = vi.hoisted(() => vi.fn());
vi.mock("../../zerops/flowVerbs", () => ({ useFlowVerbs: () => ({ merge }) }));

it("Review opens the offered change and never merges from the composer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  merge.mockClear();
  const review = vi.fn();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(() =>
      root.render(
        <ZeropsNextStepStrip
          onReview={review}
          strip={{
            title: "Nova is waiting for your review of #2",
            detail: "Add a status page",
            tint: "sky",
            target: { kind: "change", groupId: "g-1", repository: "app", number: 2 },
          }}
        />,
      ),
    );
    const button = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent === "Review",
    );
    expect(button).toBeDefined();
    await act(() => button!.click());
    expect(review).toHaveBeenCalledExactlyOnceWith(
      { kind: "change", groupId: "g-1", repository: "app", number: 2 },
      button,
    );
    expect(merge).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Merge");
  } finally {
    await act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  }
});
