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

const session = vi.hoisted(() => ({
  status: "signed-out" as "signed-out" | "signed-in" | "loading" | "unavailable",
  retrying: false,
}));

vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: session.status,
    retrying: session.retrying,
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

function renderLanding(): string {
  return renderToStaticMarkup(<ZeropsHostedLanding />);
}

it("draws the projects surface as soon as the account is verified", () => {
  session.status = "signed-in";
  try {
    expect(renderLanding()).toContain("Projects");
  } finally {
    session.status = "signed-out";
  }
});

describe("ZeropsHostedLanding entry action", () => {
  it("offers account handover without a second authentication implementation", () => {
    const markup = renderLanding();

    expect(markup).toContain("Sign in to Mate");
    expect(markup).not.toContain("Sign in to Zerops");
    expect(markup).toContain("Sign in with your Zerops account to open your projects.");
    expect(markup).toContain("Continue with your Zerops account");
    expect(markup).toContain("Create one on Zerops");
    expect(markup).toContain("Mate by Zerops");
    // No bar above the composition: the mark is the brand here.
    expect(markup).not.toContain("<header");
    expect(markup).not.toContain("Sign in with a password instead");
    expect(markup).not.toContain('name="email"');
    expect(markup).not.toContain('name="password"');
  });

  it("shows only Zerops account entry when used as the outer auth gate", () => {
    const markup = renderLanding();

    expect(markup).toContain("Continue with your Zerops account");
    expect(markup).not.toContain("Connect a backend manually");
    expect(markup).not.toContain("Manual connect");
  });
});

describe("ZeropsHostedLanding while the session is checked", () => {
  it("draws nothing into the page: the frame the load painted stands until the answer", () => {
    session.status = "loading";
    try {
      const markup = renderLanding();

      expect(markup).toBe("");
      expect(markup).not.toContain("<h1");
      expect(markup).not.toContain(">Zerops Mate<");
      expect(markup).not.toContain("Continue with your Zerops account");
    } finally {
      session.status = "signed-out";
    }
  });
});

it("offers Verify again beside a terminal verification failure", () => {
  session.status = "unavailable";
  try {
    const markup = renderLanding();
    expect(markup).toContain("Could not verify your account");
    expect(markup).toContain("Verify again");
    expect(markup).not.toContain("Checking your Zerops account");
  } finally {
    session.status = "signed-out";
  }
});

it("keeps the failure through a background retry, saying quietly that it tries again", () => {
  session.status = "unavailable";
  session.retrying = true;
  try {
    const markup = renderLanding();
    expect(markup).toContain("Could not verify your account");
    expect(markup).toContain("Trying again…");
    expect(markup).toContain("Verify again");
    expect(markup).not.toContain("Checking your Zerops account");
  } finally {
    session.status = "signed-out";
    session.retrying = false;
  }
});
