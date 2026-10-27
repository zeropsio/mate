// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { RightPanelSheet } from "./RightPanelSheet";

it("names and describes the mobile dialog without visible chrome", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  try {
    await act(() =>
      root.render(
        <RightPanelSheet open onClose={() => undefined}>
          <div>Panel content</div>
        </RightPanelSheet>,
      ),
    );
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.textContent).toBe(
      "Right panel",
    );
    expect(document.getElementById(dialog!.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Displays project tools and details.",
    );
    expect(dialog?.textContent).toContain("Panel content");
  } finally {
    await act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  }
});
