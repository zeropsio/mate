import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

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

import { SidebarChromeHeader } from "./SidebarChrome";

describe("SidebarChromeHeader", () => {
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
