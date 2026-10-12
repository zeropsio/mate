// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

const openPopupText = () =>
  document.querySelector('[data-slot="tooltip-popup"][data-open]')?.textContent ?? null;

// The owner's pick, S6 on the "Composer Strips" board (2026-10-12): "Also working" loses its line
// over the composer; Send's hover says both change the same files.
describe("Send's hover", () => {
  it.each([
    {
      hint: "Fen is also working in your main chat — both change the same files.",
      says: "Fen is also working in your main chat — both change the same files.",
    },
    { hint: null, says: null },
  ])("says the Mate works in another chat on the same files: $says", async ({ hint, says }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <ComposerPrimaryActions
            compact={false}
            pendingAction={null}
            isRunning={false}
            showPlanFollowUpPrompt={false}
            promptHasText
            isSendBusy={false}
            sendDisabledReason={null}
            sendHint={hint}
            isConnecting={false}
            isEnvironmentUnavailable={false}
            isPreparingWorktree={false}
            hasSendableContent
            onPreviousPendingQuestion={() => {}}
            onInterrupt={() => {}}
            onImplementPlanInNewThread={() => {}}
          />,
        );
      });
      const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
      expect(send.disabled).toBe(false);
      await act(async () => {
        send.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        send.dispatchEvent(new MouseEvent("mouseenter"));
        send.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(openPopupText()).toBe(says);
    } finally {
      await act(() => root.unmount());
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("says the other chat's work to everyone on Send, and a focused Send keeps focus as it starts and stops", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const draw = (hint: string | null) =>
      act(() =>
        root.render(
          <ComposerPrimaryActions
            compact={false}
            pendingAction={null}
            isRunning={false}
            showPlanFollowUpPrompt={false}
            promptHasText
            isSendBusy={false}
            sendDisabledReason={null}
            sendHint={hint}
            isConnecting={false}
            isEnvironmentUnavailable={false}
            isPreparingWorktree={false}
            hasSendableContent
            onPreviousPendingQuestion={() => {}}
            onInterrupt={() => {}}
            onImplementPlanInNewThread={() => {}}
          />,
        ),
      );
    const hint = "Fen is also working in your main chat — both change the same files.";
    try {
      await draw(null);
      const send = container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
      expect(send.getAttribute("aria-description")).toBeNull();
      send.focus();
      await draw(hint);
      expect(container.querySelector('button[aria-label="Send message"]')).toBe(send);
      expect(send.getAttribute("aria-description")).toBe(hint);
      expect(document.activeElement).toBe(send);
      await draw(null);
      expect(container.querySelector('button[aria-label="Send message"]')).toBe(send);
      expect(send.getAttribute("aria-description")).toBeNull();
      expect(document.activeElement).toBe(send);
    } finally {
      await act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
