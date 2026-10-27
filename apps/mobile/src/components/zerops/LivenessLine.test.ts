import { describe, expect, it } from "vite-plus/test";

import { livenessLinePresentation, statusTonePresentation } from "./presentation.ts";

describe("livenessLinePresentation", () => {
  it.each([
    [
      "live",
      "Live",
      "ok",
      "checkmark.circle",
      "text-zerops-status-ok-text",
      "accent-zerops-status-ok-text",
    ],
    [
      "polling",
      "Polling",
      "busy",
      "arrow.clockwise",
      "text-[var(--color-zerops-status-busy-text,var(--color-foreground-muted))]",
      "accent-[var(--color-zerops-status-busy-text,var(--color-foreground-muted))]",
    ],
    [
      "doorbell-down",
      "Doorbell down",
      "off",
      "wifi.slash",
      "text-foreground-muted",
      "accent-foreground-muted",
    ],
    [
      "last-read-failed",
      "Last read failed",
      "attention",
      "exclamationmark.triangle",
      "text-zerops-status-attention-text",
      "accent-zerops-status-attention-text",
    ],
  ] as const)(
    "presents %s with literal label and icon tint classes",
    (state, label, tone, icon, textClassName, iconTintClassName) => {
      expect(livenessLinePresentation({ state })).toEqual({
        visible: true,
        label,
        tone,
        icon,
        iconSize: 12,
        iconType: "monochrome",
        containerClassName: "flex-row items-center gap-1.5",
        textClassName: `text-3xs font-t3-medium ${textClassName}`,
        iconTintClassName,
      });
    },
  );

  it("returns only the discriminant when absent", () => {
    expect(livenessLinePresentation({ state: "absent" })).toEqual({ visible: false });
  });

  it.each([
    ["ok", "text-zerops-status-ok-text", "accent-zerops-status-ok-text"],
    [
      "busy",
      "text-[var(--color-zerops-status-busy-text,var(--color-foreground-muted))]",
      "accent-[var(--color-zerops-status-busy-text,var(--color-foreground-muted))]",
    ],
    ["attention", "text-zerops-status-attention-text", "accent-zerops-status-attention-text"],
    [
      "failed",
      "text-[var(--color-zerops-status-failed-text,var(--color-foreground-muted))]",
      "accent-[var(--color-zerops-status-failed-text,var(--color-foreground-muted))]",
    ],
    ["off", "text-foreground-muted", "accent-foreground-muted"],
  ] as const)(
    "maps %s to literal label and icon classes",
    (tone, labelClassName, iconTintClassName) => {
      expect(statusTonePresentation(tone)).toEqual({ labelClassName, iconTintClassName });
    },
  );

  it("keeps consumer detail in the visible phrase", () => {
    expect(livenessLinePresentation({ state: "live", label: "Live · updated 2 s ago" }).label).toBe(
      "Live · updated 2 s ago",
    );
  });
});
