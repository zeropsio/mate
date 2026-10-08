// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

const banner = (
  id: string,
  variant: ComposerBannerStackItem["variant"] = "warning",
): ComposerBannerStackItem => ({
  id,
  variant,
  icon: <span aria-hidden="true">!</span>,
  title: `${id} notice`,
});

describe("ComposerBannerStack", () => {
  it("says nothing where there are no notices", () => {
    expect(renderToStaticMarkup(<ComposerBannerStack items={[]} />)).toBe("");
  });

  it("keeps every notice in priority order", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front"), banner("stacked")]} />,
    );
    expect(markup.indexOf("front notice")).toBeLessThan(markup.indexOf("stacked notice"));
    expect(markup).toContain("stacked notice");
  });

  it.each(["default", "warning", "info"] as const)(
    "announces an expected %s notice as status",
    (variant) => {
      const markup = renderToStaticMarkup(
        <ComposerBannerStack items={[banner("front", variant)]} />,
      );
      expect(markup).toContain('role="status"');
      expect(markup).not.toContain('role="alert"');
      expect(markup).toContain("front notice");
    },
  );

  it("announces an actual broken action as an alert", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("failed", "error")]} />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("failed notice");
  });

  it("keeps unavailable compaction disabled and offers the named dismissal", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            ...banner("resume-compaction", "info"),
            title: "Resume with less context",
            description: "250k tokens from an older session",
            actions: (
              <button type="button" disabled>
                Compact
              </button>
            ),
            dismissLabel: "Keep full history",
            onDismiss: () => {},
          },
        ]}
      />,
    );
    expect(markup).toContain("250k tokens from an older session");
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-label="Keep full history"');
  });

  it("keeps additional notices reachable by an explicit control and preserves focus through arrivals", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(() =>
        root.render(<ComposerBannerStack items={[banner("front"), banner("second")]} />),
      );
      const toggle = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "1 more notice",
      );
      expect(toggle).toBeDefined();
      const details = host.querySelector<HTMLDivElement>(
        "[data-composer-banner-stack-expanded-items]",
      );
      expect(details?.hidden).toBe(true);
      toggle!.focus();
      await act(() => toggle!.click());
      expect(toggle!.getAttribute("aria-expanded")).toBe("true");
      expect(details?.hidden).toBe(false);
      await act(() =>
        root.render(
          <ComposerBannerStack items={[banner("front"), banner("second"), banner("third")]} />,
        ),
      );
      expect(document.activeElement).toBe(toggle);
      expect(details?.textContent).toContain("third notice");
      await act(() => toggle!.click());
      expect(details?.hidden).toBe(true);
      expect(toggle!.textContent).toBe("2 more notices");
    } finally {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("runs the action offered beside its notice", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const repair = vi.fn();
    try {
      await act(() =>
        root.render(
          <ComposerBannerStack
            items={[
              {
                ...banner("branch", "error"),
                actions: (
                  <button type="button" onClick={repair}>
                    Repair
                  </button>
                ),
              },
            ]}
          />,
        ),
      );
      const button = Array.from(host.querySelectorAll("button")).find(
        (item) => item.textContent === "Repair",
      );
      if (button === undefined) throw new Error("The notice has no Repair action.");
      await act(() => button.click());
      expect(repair).toHaveBeenCalledOnce();
    } finally {
      await act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
