// @vitest-environment happy-dom
import { ProviderInstanceId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ProviderAvailability } from "../../chat/providerAvailability.logic";
import { CrewRunsOnControl } from "./CrewRunsOnControl";

describe("CrewRunsOnControl", () => {
  it("says what the crewmate runs on, as a way into its editor", () => {
    const html = renderToStaticMarkup(
      <CrewRunsOnControl label="Runs on Claude Code · Haiku 4.5 · high" onEdit={() => {}} />,
    );
    expect(html).toContain("data-crew-runs-on");
    expect(html).toContain("Runs on Claude Code · Haiku 4.5 · high");
    expect(html).toMatch(/<button[^>]*data-crew-runs-on/u);
    expect(html).toContain(
      'aria-label="Runs on Claude Code · Haiku 4.5 · high — edit in the crewmate editor"',
    );
  });

  // S6: the status shows wherever the person could act on the agent, a crewmate's chat too.
  it("carries its agent's dot, and opens on why before the way to its editor", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const availability: ProviderAvailability = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      tone: "error",
      title: "Claude is unavailable",
      message: "Claude did not start on this environment.",
      setup: true,
    };
    const onEdit = vi.fn();
    const onOpenSetup = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(() =>
        root.render(
          <CrewRunsOnControl
            label="Runs on Claude Code · Haiku 4.5 · high"
            onEdit={onEdit}
            availability={availability}
            onOpenSetup={onOpenSetup}
          />,
        ),
      );
      const control = host.querySelector<HTMLButtonElement>("[data-crew-runs-on]")!;
      expect(control.getAttribute("aria-label")).toBe(
        "Runs on Claude Code · Haiku 4.5 · high, Claude is unavailable",
      );
      expect(
        control
          .querySelector('[role="img"][aria-label="Claude is unavailable"]')
          ?.getAttribute("data-tone"),
      ).toBe("error");
      await act(() => control.click());
      const note = document.querySelector("[data-agent-availability]")!;
      expect(note.textContent).toContain("Claude did not start on this environment.");
      const edit = Array.from(note.querySelectorAll("button")).find(
        (button) => button.textContent === "Edit in the crewmate editor",
      );
      await act(() => edit!.click());
      expect(onEdit).toHaveBeenCalledOnce();
    } finally {
      await act(() => root.unmount());
      host.remove();
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    }
  });
});
