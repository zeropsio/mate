import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const runtime = vi.hoisted(() => ({
  isElectron: false,
}));

vi.mock("~/env", () => ({
  get isElectron() {
    return runtime.isElectron;
  },
}));

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

beforeEach(() => {
  runtime.isElectron = false;
});

describe("ZeropsHostedLanding entry action", () => {
  it("keeps the hand-over primary and password form collapsed on the hosted web", () => {
    const markup = renderLanding();

    expect(markup).toContain("Continue with Zerops");
    expect(markup).toContain("Create one on Zerops");
    expect(markup).toContain("Sign in with a password instead");
    expect(markup).not.toContain('name="email"');
    expect(markup).not.toContain('name="password"');
  });

  it("makes email and password primary without offering the broken hand-over on desktop", () => {
    runtime.isElectron = true;

    const markup = renderLanding();

    expect(markup).toContain('name="email"');
    expect(markup).toContain('name="password"');
    expect(markup).toContain(">Sign in</button>");
    expect(markup).not.toContain("Continue with Zerops");
    expect(markup).not.toContain("Create one on Zerops");
    expect(markup).not.toContain("Sign in with a password instead");
  });

  it("shows only Zerops account entry when used as the outer auth gate", () => {
    const markup = renderLanding(true);

    expect(markup).toContain("Continue with Zerops");
    expect(markup).not.toContain("Connect a backend manually");
    expect(markup).not.toContain("Manual connect");
  });
});
