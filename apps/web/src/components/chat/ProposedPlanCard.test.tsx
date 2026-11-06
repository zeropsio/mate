// @vitest-environment happy-dom

import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("the plan's copy action copies the plan and confirms that same action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const host = document.createElement("div");
  document.body.append(host);
  const { ProposedPlanCard } = await import("./ProposedPlanCard");
  const root = createRoot(host);
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
      trigger!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    const action = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (item) => item.textContent === "Copy to clipboard",
    );
    expect(action).toBeDefined();
    await act(async () => {
      action!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(plan);
    await act(async () => {
      trigger!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(document.body.textContent).toContain("Copied!");
    expect(document.body.textContent).not.toContain("Copy message");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
