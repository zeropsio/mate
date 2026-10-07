// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { ConversationOpeningStage } from "./ConversationOpeningStage";

it("holds one waiting face until the conversation is ready, then opens its eyes as the conversation appears", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const show = (ready: boolean) =>
    root.render(
      <ConversationOpeningStage
        ready={ready}
        name="Sage"
        mate={{
          name: "Sage",
          tint: "rose",
          shape: "flower",
          project: "Ahmad Tea",
          connected: true,
        }}
      />,
    );
  try {
    await act(() => show(false));
    const stage = host.querySelector("[data-conversation-opening]");
    const face = host.querySelector("[data-mate-face-state]");
    expect(face?.getAttribute("data-mate-face-state")).toBe("sleep");
    expect(host.textContent).toContain("Sage is opening the conversation.");
    await act(() => show(false));
    expect(host.querySelectorAll("[data-conversation-opening]")).toHaveLength(1);
    expect(host.querySelector("[data-mate-face-state]")).toBe(face);
    // An animation finishing cannot manufacture readiness.
    await act(() => face?.dispatchEvent(new Event("animationend", { bubbles: true })));
    expect(face?.getAttribute("data-mate-face-state")).toBe("sleep");
    await act(() => show(true));
    expect(host.querySelector("[data-conversation-opening]")).toBe(stage);
    expect(host.querySelector("[data-mate-face-state]")).toBe(face);
    expect(face?.getAttribute("data-mate-face-state")).toBe("idle");
    expect(stage?.getAttribute("aria-hidden")).toBe("true");
    expect(stage?.getAttribute("data-conversation-opening")).toBe("ready");
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("an immediately ready conversation shows no opening stage or animation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(() => root.render(<ConversationOpeningStage ready name="Sage" mate={null} />));
    expect(host.children).toHaveLength(0);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
