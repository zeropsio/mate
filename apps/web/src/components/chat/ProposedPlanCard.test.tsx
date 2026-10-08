import { EnvironmentId } from "@t3tools/contracts";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("the plan's copy action copies the plan and confirms that same action", async () => {
  const browser = new Window();
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", browser.document);
  vi.stubGlobal("Element", browser.Element);
  vi.stubGlobal("HTMLElement", browser.HTMLElement);
  vi.stubGlobal("Node", browser.Node);
  vi.stubGlobal("customElements", browser.customElements);
  vi.stubGlobal("MutationObserver", browser.MutationObserver);
  vi.stubGlobal("ResizeObserver", browser.ResizeObserver);
  vi.stubGlobal("ShadowRoot", browser.ShadowRoot);
  vi.stubGlobal("getComputedStyle", browser.getComputedStyle.bind(browser));
  vi.stubGlobal("requestAnimationFrame", browser.requestAnimationFrame.bind(browser));
  vi.stubGlobal("cancelAnimationFrame", browser.cancelAnimationFrame.bind(browser));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", browser.navigator);
  const writeText = vi.spyOn(browser.navigator.clipboard, "writeText").mockResolvedValue();
  const host = browser.document.createElement("div");
  browser.document.body.append(host);
  const { ProposedPlanCard } = await import("./ProposedPlanCard");
  const root = createRoot(host as unknown as HTMLElement);
  const plan = "# Example plan\n\n1. Read the source.\n2. Make the change.\n";
  try {
    await act(async () => {
      root.render(
        <ProposedPlanCard
          planMarkdown={plan}
          environmentId={EnvironmentId.make("copy-plan-environment")}
          cwd={undefined}
          workspaceRoot={undefined}
        />,
      );
    });
    const trigger = host.querySelector('button[aria-label="Plan actions"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.dispatchEvent(
        new browser.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    const action = Array.from(browser.document.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent === "Copy to clipboard",
    );
    expect(action).toBeDefined();
    await act(async () => {
      action!.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(plan);
    await act(async () => {
      trigger!.dispatchEvent(
        new browser.KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    expect(browser.document.body.textContent).toContain("Copied!");
    expect(browser.document.body.textContent).not.toContain("Copy message");
  } finally {
    await act(async () => root.unmount());
    await browser.happyDOM.abort();
  }
});
