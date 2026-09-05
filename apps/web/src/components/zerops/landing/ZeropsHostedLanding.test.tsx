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

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-out",
    signIn: vi.fn(),
    register: vi.fn(),
    verifyTotp: vi.fn(),
  }),
  zeropsErrorMessage: () => "Zerops request failed",
}));

vi.mock("~/zerops/turnstile", () => ({
  useZeropsTurnstile: () => ({
    state: { status: "unavailable", reason: "Unavailable in this test" },
    widget: null,
  }),
}));

vi.mock("../ZeropsProjectsPage", () => ({
  ZeropsProjectsPage: () => <div>Projects</div>,
}));

import { ZeropsHostedLanding } from "./ZeropsHostedLanding";

function renderLanding(exclusive = false): string {
  return renderToStaticMarkup(
    <ZeropsHostedLanding exclusive={exclusive} manualFallback={<div>Manual connect</div>} />,
  );
}

describe("ZeropsHostedLanding entry action", () => {
  it("keeps the hand-over primary and password form collapsed, on every client", () => {
    const markup = renderLanding();

    expect(markup).toContain("Continue with Zerops");
    expect(markup).toContain("Create one on Zerops");
    expect(markup).toContain("Sign in with a password instead");
    expect(markup).not.toContain('name="email"');
    expect(markup).not.toContain('name="password"');
  });

  it("shows only Zerops account entry when used as the outer auth gate", () => {
    const markup = renderLanding(true);

    expect(markup).toContain("Continue with Zerops");
    expect(markup).not.toContain("Connect a backend manually");
    expect(markup).not.toContain("Manual connect");
  });
});
