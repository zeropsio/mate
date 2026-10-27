// @vitest-environment happy-dom
import { ProviderInstanceId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { UnavailableAgentControl } from "./AgentAvailability";
import type { ProviderAvailability } from "./providerAvailability.logic";

describe("the composer's control when no agent can run", () => {
  it("says why in its name and in what it opens, with the way to the agent's setup", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const availability: ProviderAvailability = {
      instanceId: ProviderInstanceId.make("codex"),
      tone: "error",
      title: "Codex is unavailable",
      message: "Codex is not installed on this environment.",
      setup: true,
    };
    const onOpenSetup = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(() =>
        root.render(
          <UnavailableAgentControl availability={availability} onOpenSetup={onOpenSetup} />,
        ),
      );
      const control = host.querySelector<HTMLButtonElement>("[data-chat-provider-unavailable]")!;
      expect(control.getAttribute("aria-label")).toBe(
        "Codex is unavailable: Codex is not installed on this environment.",
      );
      await act(() => control.click());
      const note = document.querySelector("[data-agent-availability]")!;
      expect(note.textContent).toContain("Codex is not installed on this environment.");
      const setup = Array.from(note.querySelectorAll("button")).find(
        (button) => button.textContent === "Open coding agent setup",
      );
      await act(() => setup!.click());
      expect(onOpenSetup).toHaveBeenCalledOnce();
    } finally {
      await act(() => root.unmount());
      host.remove();
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    }
  });
});
