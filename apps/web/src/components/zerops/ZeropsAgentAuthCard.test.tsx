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
  it("renders the exact snapshot as branded semantic agent rows", () => {
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
    expect(html).toContain("Authorize coding agents");
    expect(html.match(/data-zerops-agent-identity/g)).toHaveLength(2);
    expect(html).toContain('data-zerops-agent-logo="claude-code"');
    expect(html).toContain('data-zerops-agent-logo="codex"');
    expect(html).toContain('data-zerops-status-tone="attention"');
    expect(html).toContain('data-zerops-status-tone="ok"');
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
    expect(html).toContain("data-zerops-agent-primary-action");
    expect(html).toContain("rounded-[var(--zerops-pill-radius)]");
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
  it("offers the modal again while the server prepares the login", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", login: loginState({ phase: "menu" }) }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Continue authorization");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("Choosing");
  });

  it("keeps browser details in the modal instead of expanding the tray", () => {
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

    expect(html).not.toContain('href="https://claude.com/cai/oauth/authorize"');
    expect(html).not.toContain("Copy link");
    expect(html).toContain("Continue authorization");
    expect(html).toContain(">Cancel<");
  });

  it("keeps the Codex device code private to the focused modal", () => {
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
    expect(codexHtml).not.toContain("ABCD-12345");
    expect(codexHtml).not.toContain("Copy code");
    expect(codexHtml).toContain("Continue authorization");
    expect(codexHtml).toContain("data-zerops-agent-primary-action");
  });

  it("keeps Claude browser authorization free of a device-code action", () => {
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
    expect(claudeHtml).not.toContain("data-zerops-agent-device-code");
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

    expect(html).toContain("Continue authorization");
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
    expect(html).toContain("Review authorization");
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
    "shows Continue and Cancel while phase is %s",
    (phase) => {
      const html = renderToStaticMarkup(
        <ZeropsAgentAuthCard
          snapshot={snapshot([agent({ agentId: "claude-code", login: loginState({ phase }) })])}
          onSignIn={noop}
          onCancel={noop}
        />,
      );

      expect(html).toContain("Continue authorization");
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

  it("routes an awaiting-browser session back into the modal alongside Cancel", () => {
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

    expect(html).toContain("Continue authorization");
    expect(html).not.toContain("Open sign-in link");
    expect(html).toContain(">Cancel<");
  });
});
