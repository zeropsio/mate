// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { Tooltip, TooltipPopup, TooltipScrollDismissArea, TooltipTrigger } from "./tooltip";

const openPopupText = () =>
  document.querySelector('[data-slot="tooltip-popup"][data-open]')?.textContent ?? null;

describe("tooltip scroll dismissal", () => {
  it.each([
    { interaction: "hover", afterScroll: null },
    { interaction: "delayed hover", afterScroll: null },
    { interaction: "focus", afterScroll: "https://example.com" },
    { interaction: "hover then focus", afterScroll: "https://example.com" },
    { interaction: "outside the area", afterScroll: "https://example.com" },
    { interaction: "wheel without scroll", afterScroll: "https://example.com" },
  ])("after $interaction, a scroll leaves $afterScroll open", async (scenario) => {
    const { interaction } = scenario;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onMouseEnter = vi.fn();
    const tooltip = (
      <Tooltip>
        <TooltipTrigger delay={50} onMouseEnter={onMouseEnter}>
          message link
        </TooltipTrigger>
        <TooltipPopup>https://example.com</TooltipPopup>
      </Tooltip>
    );
    try {
      await act(async () => {
        root.render(
          <>
            <TooltipScrollDismissArea>
              {/* A nested scroller, like a run card's own scroll inside the timeline. */}
              <div data-testid="scrollable">
                {interaction === "outside the area" ? null : tooltip}
              </div>
            </TooltipScrollDismissArea>
            {interaction === "outside the area" ? tooltip : null}
          </>,
        );
      });
      const trigger = container.querySelector<HTMLButtonElement>("button")!;
      const scrollable = container.querySelector<HTMLElement>('[data-testid="scrollable"]')!;
      await act(async () => {
        if (interaction !== "focus") {
          trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          trigger.dispatchEvent(new MouseEvent("mouseenter"));
          trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        }
        if (interaction === "focus" || interaction === "hover then focus") {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
          trigger.focus();
        }
        if (interaction !== "delayed hover") {
          await vi.advanceTimersByTimeAsync(60);
        }
      });
      expect(onMouseEnter).toHaveBeenCalledTimes(interaction === "focus" ? 0 : 1);
      expect(openPopupText()).toBe(interaction === "delayed hover" ? null : "https://example.com");

      await act(async () => {
        scrollable.dispatchEvent(
          interaction === "wheel without scroll"
            ? new WheelEvent("wheel", { bubbles: true, deltaY: 100 })
            : new Event("scroll"),
        );
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(openPopupText()).toBe(scenario.afterScroll);
      if (interaction === "focus" || interaction === "hover then focus") {
        expect(document.activeElement).toBe(trigger);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
