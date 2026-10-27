import { describe, expect, it, vi } from "vite-plus/test";

import { resolveExternalWebLinkHost, showExternalLinkContextMenu } from "./externalLinkContextMenu";

function createHarness(
  selection: "open-external" | "copy-link" | "link-to-thread" | "unlink-from-thread" | null,
) {
  const showContextMenu = vi.fn().mockResolvedValue(selection);
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const copyLink = vi.fn().mockResolvedValue(undefined);
  const updateThreadLink = vi.fn().mockResolvedValue(undefined);
  const reportFailure = vi.fn();

  return {
    showContextMenu,
    openExternal,
    copyLink,
    updateThreadLink,
    reportFailure,
  };
}

describe("external chat link context menu", () => {
  it("offers the open action and Copy Link", async () => {
    const harness = createHarness(null);

    await showExternalLinkContextMenu({
      href: "https://example.com/docs?topic=menus#copy",
      position: { x: 12, y: 24 },
      ...harness,
    });

    expect(harness.showContextMenu).toHaveBeenCalledWith(
      [
        { id: "open-external", label: "Open in system browser" },
        { id: "copy-link", label: "Copy Link" },
      ],
      { x: 12, y: 24 },
    );
    expect(harness.openExternal).not.toHaveBeenCalled();
    expect(harness.copyLink).not.toHaveBeenCalled();
  });

  it("copies the exact destination without opening it", async () => {
    const harness = createHarness("copy-link");
    const href = "https://example.com/docs?topic=menus#copy";

    await showExternalLinkContextMenu({ href, position: { x: 1, y: 2 }, ...harness });

    expect(harness.copyLink).toHaveBeenCalledWith(href);
    expect(harness.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    ["link-to-thread", "Link to thread", true],
    ["unlink-from-thread", "Unlink from thread", false],
  ] as const)("offers and runs the %s action", async (action, label, linked) => {
    const harness = createHarness(action);
    const href = "https://github.com/pingdotgg/t3code/pull/42";

    await showExternalLinkContextMenu({
      href,
      threadLinkAction: action,
      position: { x: 1, y: 2 },
      ...harness,
    });

    expect(harness.showContextMenu).toHaveBeenCalledWith(
      expect.arrayContaining([{ id: action, label }]),
      { x: 1, y: 2 },
    );
    expect(harness.updateThreadLink).toHaveBeenCalledWith(href, linked);
  });

  it("preserves the open-external action", async () => {
    const harness = createHarness("open-external");
    const href = "https://example.com/docs";

    await showExternalLinkContextMenu({ href, position: { x: 1, y: 2 }, ...harness });

    expect(harness.openExternal).toHaveBeenCalledWith(href);
    expect(harness.copyLink).not.toHaveBeenCalled();
  });

  it("reports the selected action when it fails", async () => {
    const harness = createHarness("copy-link");
    const cause = new Error("clipboard denied");
    harness.copyLink.mockRejectedValue(cause);

    await showExternalLinkContextMenu({
      href: "https://example.com/docs",
      position: { x: 1, y: 2 },
      ...harness,
    });

    expect(harness.reportFailure).toHaveBeenCalledWith("copy-link", cause);
  });

  it("reports the menu operation when the native menu cannot be shown", async () => {
    const harness = createHarness(null);
    const cause = new Error("menu unavailable");
    harness.showContextMenu.mockRejectedValue(cause);

    await showExternalLinkContextMenu({
      href: "https://example.com/docs",
      position: { x: 1, y: 2 },
      ...harness,
    });

    expect(harness.reportFailure).toHaveBeenCalledWith("show-link-context-menu", cause);
    expect(harness.openExternal).not.toHaveBeenCalled();
    expect(harness.copyLink).not.toHaveBeenCalled();
  });

  it("reports a failed open-external action", async () => {
    const harness = createHarness("open-external");
    const cause = new Error("open failed");
    harness.openExternal.mockRejectedValue(cause);

    await showExternalLinkContextMenu({
      href: "https://example.com/docs",
      position: { x: 1, y: 2 },
      ...harness,
    });

    expect(harness.reportFailure).toHaveBeenCalledWith("open-link-external", cause);
  });

  it("reports a failed thread link action", async () => {
    const harness = createHarness("link-to-thread");
    const cause = new Error("thread update failed");
    harness.updateThreadLink.mockRejectedValue(cause);

    await showExternalLinkContextMenu({
      href: "https://github.com/pingdotgg/t3code/pull/42",
      threadLinkAction: "link-to-thread",
      position: { x: 1, y: 2 },
      ...harness,
    });

    expect(harness.reportFailure).toHaveBeenCalledWith("link-pull-request-to-thread", cause);
  });

  it.each([
    ["https://example.com", "example.com"],
    ["http://localhost:3000/path", "localhost"],
    ["#details", null],
    ["mailto:hello@example.com", null],
    ["file:///tmp/example.txt", null],
    ["javascript:void(0)", null],
    ["not a URL", null],
    [undefined, null],
  ])("resolves the external web-link host for %s as %s", (href, expected) => {
    expect(resolveExternalWebLinkHost(href)).toBe(expected);
  });
});
