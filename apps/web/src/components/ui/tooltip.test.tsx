// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { followScrollTo } from "~/lib/followScroll";
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

  // A run card's box and the browser strip keep themselves at their end while a run streams;
  // their own scrolls must not close a tooltip the person is reading.
  it.each([
    { scroll: "a box following its end", afterScroll: "https://example.com" },
    { scroll: "a person in a box that followed its end", afterScroll: null },
  ])("in the conversation, a scroll by $scroll leaves $afterScroll open", async (scenario) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <TooltipScrollDismissArea>
            <Tooltip>
              <TooltipTrigger delay={0}>message link</TooltipTrigger>
              <TooltipPopup>https://example.com</TooltipPopup>
            </Tooltip>
            <div data-testid="follows" style={{ height: 40, overflow: "auto" }}>
              <div style={{ height: 400 }} />
            </div>
          </TooltipScrollDismissArea>,
        );
      });
      const trigger = container.querySelector<HTMLButtonElement>("button")!;
      const box = container.querySelector<HTMLElement>('[data-testid="follows"]')!;
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent("mouseenter"));
        trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(60);
      });
      expect(openPopupText()).toBe("https://example.com");

      await act(async () => {
        followScrollTo(box, 360);
        if (scenario.scroll !== "a box following its end") box.scrollTop = 200;
        box.dispatchEvent(new Event("scroll"));
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(openPopupText()).toBe(scenario.afterScroll);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe("tooltip trigger element", () => {
  // A chat file link renders a menu button until its open action is known, then a link.
  it.each([{ area: "inside the conversation" }, { area: "outside the conversation" }])(
    "$area, a trigger that becomes a link still opens its tooltip on hover",
    async ({ area }) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      vi.useFakeTimers();
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const tooltip = (link: boolean) => (
        <Tooltip>
          <TooltipTrigger
            delay={50}
            render={link ? <a href="/workspace/src/summary.ts" /> : <button type="button" />}
          >
            summary.ts
          </TooltipTrigger>
          <TooltipPopup>/workspace/src/summary.ts</TooltipPopup>
        </Tooltip>
      );
      const render = (link: boolean) =>
        root.render(
          area === "inside the conversation" ? (
            <TooltipScrollDismissArea>{tooltip(link)}</TooltipScrollDismissArea>
          ) : (
            tooltip(link)
          ),
        );
      try {
        await act(async () => render(false));
        await act(async () => render(true));
        const trigger = container.querySelector<HTMLAnchorElement>("a")!;
        await act(async () => {
          trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          trigger.dispatchEvent(new MouseEvent("mouseenter"));
          trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
          await vi.advanceTimersByTimeAsync(60);
        });
        expect(openPopupText()).toBe("/workspace/src/summary.ts");
      } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    },
  );
});
