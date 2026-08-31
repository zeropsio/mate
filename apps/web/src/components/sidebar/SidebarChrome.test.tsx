import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZEROPS_MARK } from "@t3tools/shared/brand";
import { describe, expect, it, vi } from "vite-plus/test";

import { APP_BASE_NAME } from "../../branding";

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ to: _to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
      createElement("a", props),
  };
});

vi.mock("../ui/sidebar", async () => {
  const { createElement } = await import("react");
  return {
    SidebarHeader: (props: React.ComponentProps<"header">) => createElement("header", props),
    SidebarTrigger: (props: React.ComponentProps<"button">) => createElement("button", props),
  };
});

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "artwork",
}));

vi.mock("../../branding", () => ({
  APP_BASE_NAME: "Injected Product Name",
}));

import { SidebarChromeHeader } from "./SidebarChrome";

describe("SidebarChromeHeader", () => {
  it("renders the shared Zerops mark and sourced product name without T3 branding", () => {
    const markup = renderToStaticMarkup(<SidebarChromeHeader isElectron={false} />);

    expect(markup).toContain(`viewBox="${ZEROPS_MARK.viewBox}"`);
    expect(markup).toContain(`aria-hidden="true"`);
    expect(markup).toContain(`aria-label="Go to threads"`);
    expect(markup).toContain(APP_BASE_NAME);
    expect(markup).not.toContain("T3");
  });

  it("renders no stage artwork with a built-in theme selected", () => {
    const markup = renderToStaticMarkup(
      <div data-theme-id="t3-chat">
        <SidebarChromeHeader isElectron={false} />
      </div>,
    );

    expect(markup).not.toContain("sidebar-stage-backdrop");
    expect(markup).not.toContain("stage-art");
  });
});
