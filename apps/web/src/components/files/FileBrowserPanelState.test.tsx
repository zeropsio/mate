import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { FileBrowserPanelState, resolveFileBrowserPanelState } from "./FileBrowserPanelState";

describe("resolveFileBrowserPanelState", () => {
  it.each([
    {
      name: "the first request before it starts",
      input: { hasData: false, error: null, isPending: false },
      expected: { kind: "loading" },
    },
    {
      name: "the first request in flight",
      input: { hasData: false, error: null, isPending: true },
      expected: { kind: "loading" },
    },
    {
      name: "a hard failure",
      input: { hasData: false, error: "Workspace is offline.", isPending: false },
      expected: { kind: "error", message: "Workspace is offline.", retryPending: false },
    },
    {
      name: "a hard failure being retried",
      input: { hasData: false, error: "Workspace is offline.", isPending: true },
      expected: { kind: "error", message: "Workspace is offline.", retryPending: true },
    },
    {
      name: "stale data being refreshed",
      input: { hasData: true, error: null, isPending: true },
      expected: { kind: "ready" },
    },
    {
      name: "stale data after a failed refresh",
      input: { hasData: true, error: "Refresh failed.", isPending: false },
      expected: { kind: "ready" },
    },
  ])("resolves $name", ({ input, expected }) => {
    expect(resolveFileBrowserPanelState(input)).toEqual(expected);
  });
});

describe("FileBrowserPanelState", () => {
  it("announces the first load explicitly", () => {
    const markup = renderToStaticMarkup(
      <FileBrowserPanelState hasData={false} error={null} isPending onRetry={vi.fn()}>
        <div data-testid="file-tree">Tree</div>
      </FileBrowserPanelState>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Loading files…");
    expect(markup).not.toContain("file-tree");
  });

  it.each([
    { isPending: false, label: "Retry", disabled: false },
    { isPending: true, label: "Retrying…", disabled: true },
  ])(
    "renders an actionable hard error when pending is $isPending",
    ({ isPending, label, disabled }) => {
      const onRetry = vi.fn();
      const surface = FileBrowserPanelState({
        hasData: false,
        error: "Workspace is offline.",
        isPending,
        onRetry,
        children: <div data-testid="file-tree">Tree</div>,
      });
      const markup = renderToStaticMarkup(surface);
      const retryButton = visitElements(surface, (element) => element.props.onClick === onRetry);

      expect(markup).toContain('role="alert"');
      expect(markup).toContain("Workspace is offline.");
      expect(markup).toContain(label);
      expect(retryButton?.props.disabled).toBe(disabled);
      expect(markup).not.toContain("file-tree");
    },
  );

  it("wires Retry to the supplied refresh and keeps stale data visible", () => {
    const onRetry = vi.fn();
    const hardError = FileBrowserPanelState({
      hasData: false,
      error: "Workspace is offline.",
      isPending: false,
      onRetry,
      children: <div data-testid="file-tree">Tree</div>,
    });
    const retryButton = visitElements(hardError, (element) => element.props.onClick === onRetry);

    expect(retryButton).not.toBeNull();
    (retryButton?.props.onClick as (() => void) | undefined)?.();
    expect(onRetry).toHaveBeenCalledOnce();

    const staleMarkup = renderToStaticMarkup(
      <FileBrowserPanelState hasData error="Refresh failed." isPending onRetry={onRetry}>
        <div data-testid="file-tree">Tree</div>
      </FileBrowserPanelState>,
    );
    expect(staleMarkup).toContain("file-tree");
    expect(staleMarkup).not.toContain("Loading files…");
    expect(staleMarkup).not.toContain("Refresh failed.");
  });
});
