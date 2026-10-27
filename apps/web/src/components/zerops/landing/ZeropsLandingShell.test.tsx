import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
      createElement("a", { href: to, ...props }),
  };
});

import { ZeropsByline, ZeropsHandoverActions, ZeropsLandingShell } from "./ZeropsLandingShell";

const noop = () => undefined;

describe("ZeropsLandingShell", () => {
  it("always offers a way to upstream's manual connect flow", () => {
    const markup = renderToStaticMarkup(
      <ZeropsLandingShell title="Zerops Mate" description="Sign in" onManualConnect={noop}>
        <p>card</p>
      </ZeropsLandingShell>,
    );

    expect(markup).toContain("Connect a backend manually");
  });

  it("is one composition: no bar above it, the byline at its foot, the brand said by the mark", () => {
    const markup = renderToStaticMarkup(
      <ZeropsLandingShell title="Sign in to Mate" description="Pick an environment.">
        <p>card</p>
      </ZeropsLandingShell>,
    );

    expect(markup).not.toContain("<header");
    expect(markup).toContain('data-mate-mark="live"');
    expect(markup).toContain("<h1");
    expect(markup.indexOf("card")).toBeLessThan(markup.indexOf('data-zerops-byline="true"'));
    expect(markup).toContain("Mate by Zerops");
    expect(markup).toContain('href="https://zerops.io"');
    // The company's name is in the byline; the shell itself says it nowhere else.
    expect(markup.match(/Zerops/gu)).toHaveLength(1);
  });

  it("hides manual backend onboarding in the exclusive Zerops account gate", () => {
    const markup = renderToStaticMarkup(
      <ZeropsLandingShell title="Sign in to Mate" description="Sign in">
        <p>card</p>
      </ZeropsLandingShell>,
    );

    expect(markup).toContain("Sign in to Mate");
    expect(markup).not.toContain("Connect a backend manually");
  });
});

describe("ZeropsByline", () => {
  it("says who made this, with the company's mark, and opens the company's site", () => {
    const markup = renderToStaticMarkup(<ZeropsByline />);
    expect(markup).toContain("Mate by Zerops");
    expect(markup).toContain('data-zerops-mark-tone="brand"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });
});

describe("ZeropsHandoverActions", () => {
  it("offers the ordinary in-tab hand-over when no native sign-in is in progress", () => {
    const markup = renderToStaticMarkup(
      <ZeropsHandoverActions onContinue={noop} onCreateAccount={noop} />,
    );

    expect(markup).toContain("Continue with your Zerops account");
    expect(markup).toContain("Create one on Zerops");
    expect(markup).not.toContain("Continue in your browser");
  });

  // A window that appears to have done nothing on click is the worst answer
  // to "the browser has the flow now" — this state names what's happening
  // and gives a way back.
  it("names the browser and offers a way back while a native sign-in is in flight", () => {
    const markup = renderToStaticMarkup(
      <ZeropsHandoverActions
        onContinue={noop}
        onCreateAccount={noop}
        nativeSignIn={{ busy: true, error: null, onCancel: noop }}
      />,
    );

    expect(markup).toContain("Continue in your browser");
    expect(markup).toContain("Cancel");
    expect(markup).not.toContain("Continue with your Zerops account");
  });

  it("names a native sign-in's code as the one to expect if Zerops shows one", () => {
    const markup = renderToStaticMarkup(
      <ZeropsHandoverActions
        onContinue={noop}
        onCreateAccount={noop}
        nativeSignIn={{ busy: true, userCode: "ABCD-EFGH", error: null, onCancel: noop }}
      />,
    );

    expect(markup).not.toMatch(/>\s*Zerops shows/u);
    expect(markup).toMatch(/If Zerops shows a code, it&#x27;s .*ABCD-EFGH/u);
  });

  it("surfaces a native sign-in error once no longer busy", () => {
    const markup = renderToStaticMarkup(
      <ZeropsHandoverActions
        onContinue={noop}
        onCreateAccount={noop}
        nativeSignIn={{ busy: false, error: "Sign-in was cancelled.", onCancel: noop }}
      />,
    );

    expect(markup).toContain("Continue with your Zerops account");
    expect(markup).toContain("Sign-in was cancelled.");
  });
});
