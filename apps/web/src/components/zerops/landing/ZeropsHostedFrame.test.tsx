import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } =
  await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
const render = (element: React.ReactElement) =>
  renderToStaticMarkup(<RouterContextProvider router={router}>{element}</RouterContextProvider>);
const { ZeropsHostedFrame } = await import("./ZeropsHostedFrame");
const { SidebarProvider } = await import("../../ui/sidebar");

describe("ZeropsHostedFrame", () => {
  it("carries the lockup home link when it stands alone", () => {
    const html = render(
      <ZeropsHostedFrame actions={<button type="button">Sign out</button>}>
        <p>content</p>
      </ZeropsHostedFrame>,
    );
    expect(html).toContain('data-zerops-frame="standalone"');
    expect(html).toContain("data-mate-lockup=");
    expect(html).toContain('href="/"');
    expect(html).toContain("Sign out");
    expect(html).toContain("content");
    // The product's name is set once, by the lockup — never as a second text.
    expect(html).not.toContain(">Zerops Mate<");
  });

  it("keeps the breadcrumb after the lockup when standing alone", () => {
    const html = render(
      <ZeropsHostedFrame breadcrumb={<nav>Environments / New</nav>}>
        <p>content</p>
      </ZeropsHostedFrame>,
    );
    expect(html.indexOf("data-mate-lockup=")).toBeLessThan(html.indexOf("Environments / New"));
  });

  it("leaves the brand to the sidebar inside the app shell and shows the breadcrumb", () => {
    const html = render(
      <SidebarProvider>
        <ZeropsHostedFrame breadcrumb={<nav>Environments / New</nav>}>
          <p>content</p>
        </ZeropsHostedFrame>
      </SidebarProvider>,
    );
    expect(html).toContain('data-zerops-frame="shell"');
    expect(html).not.toContain("data-mate-lockup=");
    expect(html).toContain("Environments / New");
  });

  it("draws no bar when told not to, and still carries the byline at the foot", () => {
    const html = render(
      <ZeropsHostedFrame
        bar={false}
        centered
        footer={<a href="https://zerops.io">Mate by Zerops</a>}
      >
        <p>card</p>
      </ZeropsHostedFrame>,
    );
    expect(html).not.toContain("<header");
    expect(html).not.toContain("data-zerops-frame");
    expect(html).not.toContain("data-mate-lockup=");
    expect(html.indexOf("card")).toBeLessThan(html.indexOf("<footer"));
    expect(html).toContain("Mate by Zerops");
  });

  it("centres a single card when asked, and frames a page otherwise", () => {
    const page = render(
      <ZeropsHostedFrame>
        <p>page</p>
      </ZeropsHostedFrame>,
    );
    // The bar's content shares the page's column, so its edges line up with the content's.
    expect(page.match(/max-w-5xl/gu)).toHaveLength(2);
  });
});
