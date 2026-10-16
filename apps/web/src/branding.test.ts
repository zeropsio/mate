import { markupDom } from "../test/markupDom";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import indexHtml from "../index.html?raw";
import {
  buildDocumentTitle,
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Zerops Mate",
            stageLabel: "Nightly",
            displayName: "Zerops Mate (Nightly)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Zerops Mate");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("Zerops Mate (Nightly)");
  });

  it("normalizes hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("nightly");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Nightly");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("Zerops Mate (Nightly)");
  });

  it("does not label the latest hosted app channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("latest");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Latest");
    expect(branding.APP_STAGE_LABEL).toBe("Latest");
    expect(branding.APP_DISPLAY_NAME).toBe("Zerops Mate");
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });

  // Run 2: the tab read "Zerops Mate (Alpha)" from the page, then "Zerops Mate" once the app ran.
  it.each([
    { name: "the latest hosted build", channel: "latest", dev: false, title: "Zerops Mate" },
    { name: "a nightly build", channel: "nightly", dev: false, title: "Zerops Mate (Nightly)" },
    { name: "a dev server", channel: "", dev: true, title: "Zerops Mate (Dev)" },
    { name: "any other build", channel: "", dev: false, title: "Zerops Mate (Alpha)" },
  ])("titles the boot shell as the app titles the tab: $name", ({ channel, dev, title }) => {
    expect(buildDocumentTitle({ baseName: "Zerops Mate", channel, dev })).toBe(title);
  });

  it("brands the pre-React boot shell as Zerops Mate", () => {
    const document = markupDom(indexHtml);
    expect(document.title).toBe("Zerops Mate (Alpha)");
    expect(document.querySelector('[aria-label="Zerops Mate splash screen"]')).not.toBeNull();
    expect(document.querySelector('[role="img"][aria-label="Zerops Mate"]')).not.toBeNull();
  });
});

describe("branding logic", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it("updates the display name for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Zerops Mate",
        fallbackDisplayName: "Zerops Mate (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
    ).toBe("Zerops Mate (Nightly)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Zerops Mate",
        fallbackDisplayName: "Zerops Mate (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("Zerops Mate (Alpha)");
  });

  it("keeps the fallback display name for malformed nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Zerops Mate",
        fallbackDisplayName: "Zerops Mate (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616",
      }),
    ).toBe("Zerops Mate (Alpha)");
  });
});
