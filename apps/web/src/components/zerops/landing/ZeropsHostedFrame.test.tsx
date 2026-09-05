import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { MATE_LOCKUP } from "@t3tools/shared/brand";

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
      createElement("a", { href: to, ...props }),
  };
});

const { ZeropsHostedFrame } = await import("./ZeropsHostedFrame");
const { SidebarProvider } = await import("../../ui/sidebar");

describe("ZeropsHostedFrame", () => {
  it("carries the lockup home link when it stands alone", () => {
    const html = renderToStaticMarkup(
      <ZeropsHostedFrame actions={<button type="button">Sign out</button>}>
        <p>content</p>
      </ZeropsHostedFrame>,
    );
    expect(html).toContain('data-zerops-frame="standalone"');
    expect(html).toContain(`viewBox="${MATE_LOCKUP.viewBox}"`);
    expect(html).toContain('href="/"');
    expect(html).toContain("Sign out");
    expect(html).toContain("content");
    // The product's name is set once, by the lockup — never as a second text.
    expect(html).not.toContain(">Zerops Mate<");
  });

  it("keeps the breadcrumb after the lockup when standing alone", () => {
    const html = renderToStaticMarkup(
      <ZeropsHostedFrame breadcrumb={<nav>Environments / New</nav>}>
        <p>content</p>
      </ZeropsHostedFrame>,
    );
    expect(html.indexOf(`viewBox="${MATE_LOCKUP.viewBox}"`)).toBeLessThan(
      html.indexOf("Environments / New"),
    );
  });

  it("leaves the brand to the sidebar inside the app shell and shows the breadcrumb", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <ZeropsHostedFrame breadcrumb={<nav>Environments / New</nav>}>
          <p>content</p>
        </ZeropsHostedFrame>
      </SidebarProvider>,
    );
    expect(html).toContain('data-zerops-frame="shell"');
    expect(html).not.toContain(`viewBox="${MATE_LOCKUP.viewBox}"`);
    expect(html).toContain("Environments / New");
  });

  it("centres a single card when asked, and frames a page otherwise", () => {
    const centred = renderToStaticMarkup(
      <ZeropsHostedFrame centered>
        <p>card</p>
      </ZeropsHostedFrame>,
    );
    expect(centred).toContain("items-center justify-center");
    const page = renderToStaticMarkup(
      <ZeropsHostedFrame>
        <p>page</p>
      </ZeropsHostedFrame>,
    );
    // The bar's content shares the page's column, so its edges line up with the content's.
    expect(page.match(/max-w-5xl/gu)).toHaveLength(2);
  });
});
