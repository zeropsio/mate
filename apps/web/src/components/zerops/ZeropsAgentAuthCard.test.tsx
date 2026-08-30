import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type {
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentLoginState,
} from "@t3tools/contracts";

import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";

const agent = (
  overrides: Partial<ZeropsAgentAuth> & Pick<ZeropsAgentAuth, "agentId">,
): ZeropsAgentAuth => ({
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  state: "not-authorized",
  providerAuth: "unknown",
  ...overrides,
});

const snapshot = (agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents,
});

const noop = () => {};

describe("ZeropsAgentAuthCard", () => {
  it("renders one row per agent, with its name and state label", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", state: "not-authorized" }),
          agent({
            agentId: "codex",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Claude Code");
    expect(html).toContain("Codex");
    expect(html).toContain("Not signed in");
    expect(html).toContain("Authorized");
    expect(html).toContain("data-zerops-agent-auth-card");
  });

  it("shows a sign-in button for a not-authorized agent", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "claude-code", state: "not-authorized" })])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Sign in to Claude");
  });

  it("shows a sign-in button for a reconnect agent, worded the same as not-authorized", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "codex", state: "reconnect" })])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Sign in to Codex");
    expect(html).toContain("Reconnect needed");
  });

  it("shows a disabled 'Registering…' button while local-only and the provider agrees", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "local-only",
            credPresent: true,
            providerAuth: "authenticated",
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).not.toContain("Sign in to Claude");
    // A tight check: the `disabled:` Tailwind variant sits in every button's
    // className regardless of state, so a bare "disabled" substring would
    // pass even with the prop missing. The rendered boolean HTML attribute
    // is what actually disables the control.
    expect(html).toContain('disabled=""');
    expect(html).toContain("registering with Zerops");
  });

  it("shows no button at all once authorized and the provider agrees", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).not.toContain("<button");
    expect(html).toContain("Authorized");
  });

  it("shows no button at all once authorized via token and the provider agrees", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "codex",
            state: "authorized-token",
            credPresent: true,
            providerAuth: "authenticated",
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).not.toContain("<button");
    expect(html).toContain("Authorized (token)");
  });

  /**
   * `state` and the live `providerAuth` check can disagree — a credential
   * file that is present but expired, revoked, or belongs to a signed-out
   * account. `providerAuth` wins: the card still has to offer a way back in.
   */
  it("shows an enabled sign-in button when authorized but the provider disagrees", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "unauthenticated",
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Sign in to Claude");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("Claude/Codex reports not authenticated");
  });

  it("shows an enabled sign-in button when local-only but the provider disagrees", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "codex",
            state: "local-only",
            credPresent: true,
            providerAuth: "unauthenticated",
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Sign in to Codex");
    expect(html).not.toContain('disabled=""');
  });

  it("shows a disabled 'Checking…' button while the provider check is still in flight", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "unknown",
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).not.toContain("Sign in to Claude");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Checking…");
  });
});

const loginState = (
  overrides: Partial<ZeropsAgentLoginState> & { phase: ZeropsAgentLoginState["phase"] },
): ZeropsAgentLoginState => ({
  terminalId: "agent-login-claude-code",
  startedAt: new Date("2026-08-29T12:00:00.000Z") as unknown as ZeropsAgentLoginState["startedAt"],
  ...overrides,
});

describe("ZeropsAgentAuthCard — server-driven login session (S7 follow-up F8)", () => {
  it("shows a disabled 'Signing in…' placeholder in the menu phase, no sign-in button", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", login: loginState({ phase: "menu" }) }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).not.toContain("Sign in to Claude");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Signing in…");
    expect(html).toContain("Choosing");
  });

  it("shows an Open sign-in link and a Copy link button once a url is known", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            login: loginState({
              phase: "awaiting-browser",
              url: "https://claude.com/cai/oauth/authorize",
            }),
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain('href="https://claude.com/cai/oauth/authorize"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Open sign-in link");
    expect(html).toContain("Copy link");
  });

  it("also shows a Copy code button for codex's device code, but not for claude", () => {
    const codexHtml = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "codex",
            login: loginState({
              phase: "awaiting-browser",
              url: "https://auth.openai.com/codex/device",
              code: "ABCD-12345",
            }),
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(codexHtml).toContain("Copy code ABCD-12345");

    const claudeHtml = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            login: loginState({
              phase: "awaiting-browser",
              url: "https://claude.com/x",
              code: "ABCD-12345",
            }),
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(claudeHtml).not.toContain("Copy code");
  });

  it("shows the paste-into-terminal prompt and a Cancel button in awaiting-code (S7 fix2 finding 4)", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", login: loginState({ phase: "awaiting-code" }) }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Paste the code into the terminal below");
    expect(html).toContain(">Cancel<");
  });

  it("shows Authorized with no button once succeeded", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", login: loginState({ phase: "succeeded" }) }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Authorized");
    expect(html).not.toContain("<button");
  });

  it("shows the failure message and a Sign in again button on failure", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "codex",
            login: loginState({ phase: "failed", message: "Authentication failed." }),
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Authentication failed.");
    expect(html).toContain("Sign in again");
  });

  it("a cancelled session falls back to the baseline not-authorized row (as if there were no session)", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", login: loginState({ phase: "cancelled" }) }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Not signed in");
    expect(html).toContain("Sign in to Claude");
  });
});

/**
 * S7 fix2 finding 4: the card had no way to stop an in-progress login
 * session — the second live pass had nothing to abandon a stuck flow with
 * except reloading the page.
 */
describe("ZeropsAgentAuthCard — cancel (S7 fix2 finding 4)", () => {
  it.each(["starting", "menu", "awaiting-browser", "awaiting-code"] as const)(
    "shows a Cancel button while phase is %s",
    (phase) => {
      const html = renderToStaticMarkup(
        <ZeropsAgentAuthCard
          snapshot={snapshot([agent({ agentId: "claude-code", login: loginState({ phase }) })])}
          onSignIn={noop}
          onCancel={noop}
        />,
      );

      expect(html).toContain(">Cancel<");
    },
  );

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "shows no Cancel button once phase is %s (session already ended)",
    (phase) => {
      const html = renderToStaticMarkup(
        <ZeropsAgentAuthCard
          snapshot={snapshot([agent({ agentId: "claude-code", login: loginState({ phase }) })])}
          onSignIn={noop}
          onCancel={noop}
        />,
      );

      expect(html).not.toContain(">Cancel<");
    },
  );

  it("shows no Cancel button when there is no active session", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "claude-code", state: "not-authorized" })])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).not.toContain(">Cancel<");
  });

  it("still shows Open sign-in link / Copy link alongside Cancel in awaiting-browser", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            login: loginState({
              phase: "awaiting-browser",
              url: "https://claude.com/cai/oauth/authorize",
            }),
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Open sign-in link");
    expect(html).toContain(">Cancel<");
  });
});
