import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type {
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
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
    // Codex is in, so Claude's row is an offer: no attention tone anywhere.
    expect(html).toContain('data-zerops-status-tone="off"');
    expect(html).not.toContain('data-zerops-status-tone="attention"');
    expect(html).toContain('data-zerops-status-tone="ok"');
  });

  // The card is the agents' own home now (D6 round 5): it stays up once
  // nothing demands attention, just with a header that stops demanding.
  it("keeps the demanding header only while some agent needs attention", () => {
    const demanding = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "claude-code", state: "not-authorized" })])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(demanding).toContain("Authorize coding agents");

    const settled = renderToStaticMarkup(
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
    expect(settled).not.toContain("Authorize coding agents");
    expect(settled).toContain("Coding agents");
  });

  it("demands a sign-in only while no agent is signed in", () => {
    const alone = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "claude-code", state: "not-authorized" })])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(alone).toContain("Action required");
    expect(alone).toContain('data-zerops-status-tone="attention"');

    const withClaude = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
          }),
          agent({ agentId: "codex", state: "not-authorized" }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(withClaude).not.toContain("Action required");
    expect(withClaude).toContain("Not signed in");
    expect(withClaude).toContain("Sign in to Codex");
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
    expect(html).toContain("This container has no login for it");
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

  // A row for a fully-authorized agent now carries account actions (D6
  // round 5): who runs it is never a dead end, whichever account it is.
  it("offers to switch accounts once authorized by the viewer and the provider agrees", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
            authorizedBy: { subject: "user-a" },
          }),
        ])}
        viewerSubject="user-a"
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Authorized");
    expect(html).toContain("data-zerops-agent-switch-account");
    expect(html).toContain(">Switch account<");
    expect(html).not.toContain("data-zerops-agent-sign-out");
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
    expect(html).toContain("Authorized by a project token");
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
    expect(html).toContain("Its login no longer works");
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

  // The flag decides: a set flag is signed in the moment it lands, whatever
  // the agent's own check has or has not said yet.
  // Unrecorded (nobody known to own it) rather than a dead end: the flag
  // decided the moment it was set, and the row offers a way to claim it.
  it("offers to use my account while the agent's own check is still in flight", () => {
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
    expect(html).toContain("data-zerops-agent-use-my-account");
    expect(html).toContain("Authorized");
  });
});

const loginState = (
  overrides: Partial<ZeropsAgentLoginState> & { phase: ZeropsAgentLoginState["phase"] },
): ZeropsAgentLoginState => ({
  terminalId: "agent-login-claude-code",
  startedAt: new Date("2026-08-29T12:00:00.000Z") as unknown as ZeropsAgentLoginState["startedAt"],
  startedBy: "user-a",
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

  it("offers account actions once succeeded and verified, ownership unrecorded", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
            login: loginState({ phase: "succeeded" }),
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Authorized");
    expect(html).toContain("data-zerops-agent-use-my-account");
  });

  it("confirms, with nothing to click, while a just-succeeded login is checked", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", login: loginState({ phase: "succeeded" }) }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Confirming");
    expect(html).not.toContain("<button");
  });

  // The succeeded session stays in the feed until the next start; a sign-out
  // since then is what the row has to say.
  it("offers Sign in again when the agent signed out after a successful login", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            providerAuth: "unauthenticated",
            login: loginState({ phase: "succeeded" }),
          }),
        ])}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain("Sign in to Claude");
    expect(html).not.toContain(">Authorized<");
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

describe("whose agent it is (D6)", () => {
  const card = (input: {
    readonly credPresent: boolean;
    readonly authorizedBy?: { readonly subject: string };
    readonly viewerSubject?: string;
    readonly recordFailed?: ReadonlySet<"claude-code">;
    readonly onRetryRecord?: (agentId: string) => void;
  }) =>
    renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            providerAuth: "authenticated",
            credPresent: input.credPresent,
            ...(input.authorizedBy === undefined
              ? {}
              : { authorizedBy: { subject: input.authorizedBy.subject } }),
          }),
        ])}
        viewerSubject={input.viewerSubject}
        recordFailed={input.recordFailed}
        onRetryRecord={input.onRetryRecord}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

  // The row carries account actions now, so it says quietly whose login
  // they would touch instead of staying silent.
  it("says quietly that the viewer's own agent is theirs", () => {
    const html = card({
      credPresent: true,
      authorizedBy: { subject: "user-a" },
      viewerSubject: "user-a",
    });
    expect(html).toContain('data-agent-id="claude-code"');
    expect(html).toContain('data-zerops-agent-ownership="mine"');
    expect(html).toContain("Signed in by you.");
    expect(html).not.toContain("text-warning");
  });

  it("says nothing when there is no credential to own", () => {
    expect(card({ credPresent: false, viewerSubject: "user-a" })).not.toContain(
      "data-zerops-agent-ownership",
    );
  });

  it("says only the signer runs an agent somebody else signed in", () => {
    const html = card({
      credPresent: true,
      authorizedBy: { subject: "user-b" },
      viewerSubject: "user-a",
    });
    expect(html).toContain('data-zerops-agent-ownership="someone-else"');
    expect(html).toContain("only they can run this agent");
    // It deserves attention rather than a quiet aside.
    expect(html).toContain("text-warning");
  });

  it("states the fact, without accusing, when nothing was recorded", () => {
    const html = card({ credPresent: true, viewerSubject: "user-a" });
    expect(html).toContain('data-zerops-agent-ownership="unrecorded"');
    expect(html).toContain("was not recorded by Zerops Mate");
    expect(html).not.toContain("text-warning");
  });

  // A viewer the client cannot identify is not evidence that the agent
  // belongs to somebody else: say the honest thing rather than the wrong one.
  it("never accuses a colleague when the viewer is unknown", () => {
    const html = card({ credPresent: true, authorizedBy: { subject: "user-b" } });
    expect(html).toContain('data-zerops-agent-ownership="unrecorded"');
  });

  it("a sign-in whose record failed says so and can be retried", () => {
    const html = card({
      credPresent: true,
      authorizedBy: { subject: "user-a" },
      viewerSubject: "user-a",
      recordFailed: new Set(["claude-code"]),
      onRetryRecord: noop,
    });

    expect(html).toContain('data-zerops-agent-ownership="record-failed"');
    expect(html).toContain("Your sign-in could not be recorded.");
    expect(html).toContain("text-warning");
    expect(html).toContain("data-zerops-agent-retry-record");
    expect(html).toContain(">Try again<");
    // The failure outranks a same-subject recorded tag: this browser's own
    // just-tried write is what happened here, whatever the tag says.
    expect(html).not.toContain('data-zerops-agent-ownership="mine"');
  });

  it("returns to mine once the record is no longer failed", () => {
    const html = card({
      credPresent: true,
      authorizedBy: { subject: "user-a" },
      viewerSubject: "user-a",
      recordFailed: new Set(),
    });

    expect(html).toContain('data-zerops-agent-ownership="mine"');
    expect(html).not.toContain("Try again");
  });
});

describe("account actions once authorized (D6 round 5)", () => {
  const authorizedCard = (
    input: {
      readonly viewerSubject?: string;
      readonly authorizedBy?: { readonly subject: string };
      readonly token?: boolean;
      readonly signOutSupported?: boolean;
      readonly onSignOut?: (agentId: ZeropsAgentId) => void;
      readonly signOutPending?: ReadonlySet<ZeropsAgentId>;
      readonly signOutError?: ReadonlyMap<ZeropsAgentId, string>;
    } = {},
  ) =>
    renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({
            agentId: "claude-code",
            state: input.token ? "authorized-token" : "authorized",
            providerAuth: "authenticated",
            credPresent: true,
            ...(input.authorizedBy === undefined ? {} : { authorizedBy: input.authorizedBy }),
          }),
        ])}
        viewerSubject={input.viewerSubject}
        signOutSupported={input.signOutSupported}
        onSignOut={input.onSignOut}
        signOutPending={input.signOutPending}
        signOutError={input.signOutError}
        onSignIn={noop}
        onCancel={noop}
      />,
    );

  it("offers Switch account and Sign out for the viewer's own login", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      authorizedBy: { subject: "user-a" },
      signOutSupported: true,
      onSignOut: noop,
    });

    expect(html).toContain(">Switch account<");
    expect(html).toContain(">Sign out<");
    expect(html).not.toContain(">Use my account<");
  });

  it("offers Use my account and Sign out for someone else's login", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      authorizedBy: { subject: "user-b" },
      signOutSupported: true,
      onSignOut: noop,
    });

    expect(html).toContain(">Use my account<");
    expect(html).toContain(">Sign out<");
    expect(html).not.toContain(">Switch account<");
  });

  it("offers Use my account and Sign out for an unrecorded login", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      signOutSupported: true,
      onSignOut: noop,
    });

    expect(html).toContain(">Use my account<");
    expect(html).toContain(">Sign out<");
  });

  it("hides Sign out where the environment does not advertise the capability", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      authorizedBy: { subject: "user-a" },
      signOutSupported: false,
    });

    expect(html).toContain(">Switch account<");
    expect(html).not.toContain(">Sign out<");
  });

  it("hides Sign out by default when the prop is not passed", () => {
    const html = authorizedCard({ viewerSubject: "user-a", authorizedBy: { subject: "user-a" } });

    expect(html).not.toContain(">Sign out<");
  });

  it("offers no account action and says the token owns it for a token-authorized agent", () => {
    const html = authorizedCard({ token: true, signOutSupported: true });

    expect(html).not.toContain(">Switch account<");
    expect(html).not.toContain(">Use my account<");
    expect(html).not.toContain(">Sign out<");
    expect(html).toContain("Authorized by a project token");
  });

  it("shows Sign out pending inline", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      authorizedBy: { subject: "user-a" },
      signOutSupported: true,
      onSignOut: noop,
      signOutPending: new Set(["claude-code"]),
    });

    expect(html).toContain('disabled=""');
    expect(html).toContain("Signing out");
  });

  it("shows the Sign out error detail inline", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      authorizedBy: { subject: "user-a" },
      signOutSupported: true,
      signOutError: new Map([["claude-code", "The container could not be reached."]]),
    });

    expect(html).toContain("data-zerops-agent-sign-out-error");
    expect(html).toContain("The container could not be reached.");
  });
});
