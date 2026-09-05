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

import {
  ZEROPS_GUI_REGISTRATION_URL,
  ZeropsHandedOffBanner,
  ZeropsHandoverActions,
  ZeropsPasswordDisclosure,
  ZeropsLandingShell,
  ZeropsRegisterForm,
  ZeropsRegistrationUnavailable,
  ZeropsSignInForm,
  ZeropsTotpForm,
} from "./ZeropsLandingShell";

const noop = () => undefined;

describe("ZeropsLandingShell", () => {
  it("always offers a way to upstream's manual connect flow", () => {
    const markup = renderToStaticMarkup(
      <ZeropsLandingShell title="Zerops Mate" description="Sign in" onManualConnect={noop}>
        <ZeropsSignInForm busy={false} error={null} onSubmit={noop} onSwitchToRegister={noop} />
      </ZeropsLandingShell>,
    );

    expect(markup).toContain("Connect a backend manually");
  });

  it("hides manual backend onboarding in the exclusive Zerops account gate", () => {
    const markup = renderToStaticMarkup(
      <ZeropsLandingShell title="Sign in to Zerops" description="Sign in">
        <ZeropsSignInForm busy={false} error={null} onSubmit={noop} onSwitchToRegister={noop} />
      </ZeropsLandingShell>,
    );

    expect(markup).toContain("Sign in to Zerops");
    expect(markup).not.toContain("Connect a backend manually");
  });

  it("asks for an email and a password, and offers sign-up", () => {
    const markup = renderToStaticMarkup(
      <ZeropsSignInForm busy={false} error={null} onSubmit={noop} onSwitchToRegister={noop} />,
    );

    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain("Create one");
  });

  it("renders the captcha the platform demands, and blocks submit until it answers", () => {
    const pending = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={<div data-testid="turnstile" />}
        captchaPending
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );
    expect(pending).toContain("turnstile");
    // The attribute, not the Tailwind `disabled:` class prefixes.
    expect(pending).toContain('disabled=""');

    const solved = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={<div data-testid="turnstile" />}
        captchaPending={false}
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );
    expect(solved).not.toContain('disabled=""');
  });

  it("collects the four fields registration needs", () => {
    const markup = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={null}
        captchaPending={false}
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );

    for (const field of ["fullName", "organizationName", "email", "password"]) {
      expect(markup).toContain(`name="${field}"`);
    }
  });

  it("shows an error where the user is looking and disables submit while busy", () => {
    const markup = renderToStaticMarkup(
      <ZeropsTotpForm busy error="The two-factor code was not accepted." onSubmit={noop} />,
    );

    expect(markup).toContain("The two-factor code was not accepted.");
    expect(markup).toContain('disabled=""');
  });
});

describe("ZeropsRegistrationUnavailable", () => {
  it("sends the user to the Zerops sign-up that the captcha does allow, with the pool claim", () => {
    const markup = renderToStaticMarkup(
      <ZeropsRegistrationUnavailable
        reason="Domain not authorized (110200)"
        onSignIn={noop}
        onHandOff={noop}
      />,
    );

    expect(ZEROPS_GUI_REGISTRATION_URL).toBe("https://app.zerops.io/registration?zcp=true");
    expect(markup).toContain(ZEROPS_GUI_REGISTRATION_URL.replace(/&/g, "&amp;"));
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });

  it("keeps the reason available in a smaller line, without leading with it", () => {
    const markup = renderToStaticMarkup(
      <ZeropsRegistrationUnavailable
        reason="Domain not authorized (110200)"
        onSignIn={noop}
        onHandOff={noop}
      />,
    );

    expect(markup).toContain("Sign-up runs on app.zerops.io.");
    expect(markup).toContain("Domain not authorized (110200)");
    // Signing up elsewhere is only useful if the flow continues here.
    expect(markup).toMatch(/sign in/i);
  });
});

describe("ZeropsHandedOffBanner", () => {
  it("explains the hand-off and still lets the user open the sign-up page again", () => {
    const markup = renderToStaticMarkup(<ZeropsHandedOffBanner onOpenSignUpAgain={noop} />);

    expect(markup).toContain(
      "Finish creating your account in the Zerops tab — it prepares a project with Zerops Mate for you. Then sign in here.",
    );
    expect(markup).toContain("Open the sign-up page again");
    expect(markup).toContain(ZEROPS_GUI_REGISTRATION_URL.replace(/&/g, "&amp;"));
    expect(markup).toContain('target="_blank"');
  });

  it("renders alongside a working sign-in form", () => {
    const markup = renderToStaticMarkup(
      <>
        <ZeropsHandedOffBanner onOpenSignUpAgain={noop} />
        <ZeropsSignInForm busy={false} error={null} onSubmit={noop} onSwitchToRegister={noop} />
      </>,
    );

    expect(markup).toContain("Finish creating your account");
    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="password"');
  });
});

describe("ZeropsHandoverActions", () => {
  it("offers the ordinary in-tab hand-over when no native sign-in is in progress", () => {
    const markup = renderToStaticMarkup(
      <ZeropsHandoverActions onContinue={noop} onCreateAccount={noop} />,
    );

    expect(markup).toContain("Continue with Zerops");
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
    expect(markup).not.toContain("Continue with Zerops");
  });

  it("surfaces a native sign-in error once no longer busy", () => {
    const markup = renderToStaticMarkup(
      <ZeropsHandoverActions
        onContinue={noop}
        onCreateAccount={noop}
        nativeSignIn={{ busy: false, error: "Sign-in was cancelled.", onCancel: noop }}
      />,
    );

    expect(markup).toContain("Continue with Zerops");
    expect(markup).toContain("Sign-in was cancelled.");
  });
});

describe("ZeropsPasswordDisclosure", () => {
  const render = (open: boolean) =>
    renderToStaticMarkup(
      <ZeropsPasswordDisclosure handover={<div>hand-over</div>} open={open} onToggle={noop}>
        <div>password form</div>
      </ZeropsPasswordDisclosure>,
    );

  it("shows one way in at a time: the hand-over, or the form", () => {
    const closed = render(false);
    expect(closed).toContain("hand-over");
    expect(closed).not.toContain("password form");
    expect(closed).toContain("Sign in with a password instead");
    expect(closed).toContain('data-zerops-password-form="closed"');

    const open = render(true);
    expect(open).toContain("password form");
    expect(open).not.toContain("hand-over");
    expect(open).toContain("Use the Zerops sign-in instead");
    expect(open).not.toContain("Sign in with a password instead");
  });
});
