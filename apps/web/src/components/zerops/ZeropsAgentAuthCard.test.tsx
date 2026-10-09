import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  type ZeropsAgentAuth,
  type ZeropsAgentAuthSnapshot,
  type ZeropsAgentId,
  type ZeropsAgentLoginState,
} from "@t3tools/contracts";
import { agentAdmission } from "@t3tools/client-runtime/data";

import type { MateLoginRow } from "@t3tools/client-runtime/zerops/logins";

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

/** Whether the conversation running `instance` is held for a sign-in, as `ChatView` asks it. */
const demanded = (feed: ZeropsAgentAuthSnapshot, instance: string): boolean =>
  agentAdmission({
    environmentId: "env",
    instanceId: ProviderInstanceId.make(instance),
    viewerSubject: "viewer",
    read: {
      state: "known",
      value: feed,
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    },
    providers: [],
    mateName: "Milo",
  }).attention !== null;

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
    expect(html).toContain("Coding agents");
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
    const signedOut = snapshot([agent({ agentId: "claude-code", state: "not-authorized" })]);
    const demanding = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={signedOut}
        signInDemanded={demanded(signedOut, "claudeAgent")}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(demanding).toContain("Authorize coding agents");

    const signedIn = snapshot([
      agent({
        agentId: "claude-code",
        state: "authorized",
        credPresent: true,
        providerAuth: "authenticated",
      }),
    ]);
    const settled = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={signedIn}
        signInDemanded={demanded(signedIn, "claudeAgent")}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(settled).not.toContain("Authorize coding agents");
    expect(settled).toContain("Coding agents");
  });

  // Milo, signed in to Claude, sat over "Authorize coding agents" because Codex
  // was not (stress run 2, 2026-10-09): the header speaks for the Mate's own agent.
  it("stops demanding once the conversation's agent is signed in, while another still offers its sign-in", () => {
    const feed = snapshot([
      agent({
        agentId: "claude-code",
        state: "authorized",
        credPresent: true,
        providerAuth: "authenticated",
      }),
      agent({ agentId: "codex", state: "not-authorized" }),
    ]);
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={feed}
        signInDemanded={demanded(feed, "claudeAgent")}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(html).not.toContain("Authorize coding agents");
    expect(html).toContain("Coding agents");
    expect(html).toContain("Sign in to Codex");
  });

  // Milo, signed in to Claude, still sat under "Sign in inside this Zerops Control Plane" with a
  // Codex Sign in row beside it (stress run 3, 2026-10-09): it read as a sign-in request.
  it("A signed-in conversation's agent shows the signed-in state; another agent's sign-in is a quiet secondary line", () => {
    const feed = snapshot([
      agent({
        agentId: "claude-code",
        state: "authorized",
        credPresent: true,
        providerAuth: "authenticated",
      }),
      agent({ agentId: "codex", state: "not-authorized" }),
    ]);
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={feed}
        conversationAgentId="claude-code"
        signInDemanded={demanded(feed, "claudeAgent")}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(html).not.toContain("Sign in inside this Zerops Control Plane");
    expect(html).toContain("Claude Code is signed in");
    expect(html.match(/data-zerops-agent-auth-row=/g)).toHaveLength(1);
    expect(html).toContain("Codex isn’t signed in");
    expect(html).toContain("Sign in to Codex");
  });

  it("While the conversation's agent needs a sign-in, the card asks for it and lists every agent", () => {
    const feed = snapshot([
      agent({ agentId: "claude-code", state: "not-authorized" }),
      agent({ agentId: "codex", state: "not-authorized" }),
    ]);
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={feed}
        conversationAgentId="claude-code"
        signInDemanded={demanded(feed, "claudeAgent")}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain("Sign in inside this Zerops Control Plane");
    expect(html.match(/data-zerops-agent-auth-row=/g)).toHaveLength(2);
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
  });

  it("states the fact, without accusing, when nothing was recorded", () => {
    const html = card({ credPresent: true, viewerSubject: "user-a" });
    expect(html).toContain('data-zerops-agent-ownership="unrecorded"');
    expect(html).toContain("was not recorded by Zerops Mate");
  });

  // A viewer the client cannot identify is not evidence that the agent
  // belongs to somebody else: say the honest thing rather than the wrong one.
  it("never accuses a colleague when the viewer is unknown", () => {
    const html = card({ credPresent: true, authorizedBy: { subject: "user-b" } });
    expect(html).toContain('data-zerops-agent-ownership="unrecorded"');
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
    expect(html).not.toContain(">Use my own account instead…<");
  });

  it("offers Use my account and Sign out for someone else's login", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      authorizedBy: { subject: "user-b" },
      signOutSupported: true,
      onSignOut: noop,
    });

    expect(html).toContain(">Use my own account instead…<");
    expect(html).toContain(">Sign out<");
    expect(html).not.toContain(">Switch account<");
  });

  it("offers Use my account and Sign out for an unrecorded login", () => {
    const html = authorizedCard({
      viewerSubject: "user-a",
      signOutSupported: true,
      onSignOut: noop,
    });

    expect(html).toContain(">Use my own account instead…<");
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
    expect(html).not.toContain(">Use my own account instead…<");
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

// Crew mode's *Runs on* (PRD §4.3): the card lists logins, not two fixed
// agents — each agent's further logins under it, whose each one is, the
// crewmates that run on it, and *Add another login* under each agent.
describe("logins", () => {
  const VIEWER = "user-a";
  const row = (overrides: Partial<MateLoginRow> & Pick<MateLoginRow, "id">): MateLoginRow => ({
    agent: "claude-code",
    label: "",
    kind: "subscription",
    default: false,
    state: "authorized",
    token: false,
    title: "Claude Code",
    crewmates: [],
    lead: null,
    ...overrides,
  });
  const agents = snapshot([
    agent({
      agentId: "claude-code",
      state: "authorized",
      providerAuth: "authenticated",
      credPresent: true,
      authorizedBy: { subject: VIEWER },
    }),
    agent({ agentId: "codex" }),
  ]);
  const LOGINS: ReadonlyArray<MateLoginRow> = [
    row({
      id: "claudeAgent",
      default: true,
      signedInBy: VIEWER,
      crewmates: ["Ada", "Backend"],
      lead: "Ada",
    }),
    row({
      id: "claudeAgent-work",
      label: "work",
      title: "Claude Code · work",
      signedInBy: VIEWER,
      crewmates: ["Frontend", "Erik"],
    }),
    row({
      id: "claudeAgent-api-key",
      kind: "apiKey",
      title: "Claude API key",
      signedInBy: VIEWER,
    }),
    row({
      id: "claudeAgent-cleo",
      label: "cleo",
      title: "Claude Code · cleo",
      signedInBy: "user-cleo",
    }),
    row({ id: "codex", agent: "codex", default: true, state: "not-authorized", title: "Codex" }),
    row({
      id: "codex-home",
      agent: "codex",
      label: "home",
      state: "not-authorized",
      title: "Codex · home",
    }),
  ];
  const card = (props: Partial<Parameters<typeof ZeropsAgentAuthCard>[0]> = {}) =>
    renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={agents}
        viewerSubject={VIEWER}
        logins={LOGINS}
        nameOf={(userId) => (userId === "user-cleo" ? "Cleo" : undefined)}
        onSignIn={noop}
        onCancel={noop}
        {...props}
      />,
    );
  /** The markup of one login's row: from its id to whatever row follows it. */
  const rowOf = (html: string, id: string) => {
    const start = html.indexOf(`data-login-id="${id}"`);
    if (start < 0) return "";
    const rest = html.slice(start + 1);
    const ends = [/data-login-id="/, /data-agent-id="/, /data-zerops-add-login=/]
      .map((pattern) => rest.search(pattern))
      .filter((index) => index >= 0);
    return rest.slice(0, ends.length === 0 ? undefined : Math.min(...ends));
  };

  it("lists each agent's other logins under it, in the agent's order", () => {
    const html = card();
    const order = [...html.matchAll(/data-login-id="([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual([
      "claudeAgent-work",
      "claudeAgent-api-key",
      "claudeAgent-cleo",
      "codex-home",
    ]);
    expect(html.indexOf("Claude Code · work")).toBeLessThan(html.indexOf('data-agent-id="codex"'));
  });

  it("says whose each login is, and which crewmates run on it", () => {
    const html = card();
    expect(rowOf(html, "claudeAgent-work")).toContain("Signed in by you");
    expect(rowOf(html, "claudeAgent-work")).toContain("Runs: Frontend, Erik");
    expect(rowOf(html, "claudeAgent-api-key")).toContain("Added by you");
    expect(rowOf(html, "codex-home")).toContain("Not signed in");
    // The default login's crewmates ride its agent row by name, the lead named as the lead.
    expect(html).toContain("Runs: Ada (lead), Backend");
  });

  it("says a teammate's login serves only their crews (N9)", () => {
    const cleo = rowOf(card(), "claudeAgent-cleo");
    expect(cleo).toContain("Signed in by Cleo");
    expect(cleo).toContain("Only Cleo&#x27;s crews can use it.");
    const unnamed = rowOf(card({ nameOf: () => undefined }), "claudeAgent-cleo");
    expect(unnamed).toContain("Signed in by another member");
    expect(unnamed).toContain("Only their crews can use it.");
  });

  it("offers a login that is not signed in its own sign-in", () => {
    const html = card({ onSignInLogin: noop });
    expect(rowOf(html, "codex-home")).toContain("data-zerops-login-sign-in");
    expect(rowOf(html, "claudeAgent-work")).not.toContain("data-zerops-login-sign-in");
  });

  it("Replacing another member's expired named sign-in remains a secondary offer", () => {
    const html = card({
      logins: [row({ id: "claudeAgent-ann", signedInBy: "ann", state: "needs-reauth" })],
      onSignInLogin: noop,
    });
    expect(rowOf(html, "claudeAgent-ann")).toContain("Use my own account instead…");
  });

  it("offers your own account Sign out and Remove, and an API key only Remove", () => {
    const html = card({ onSignOutLogin: noop, onRemoveLogin: noop });
    expect(rowOf(html, "claudeAgent-work")).toContain("data-zerops-login-sign-out");
    expect(rowOf(html, "claudeAgent-work")).toContain("data-zerops-login-remove");
    expect(rowOf(html, "claudeAgent-api-key")).not.toContain("data-zerops-login-sign-out");
    expect(rowOf(html, "claudeAgent-api-key")).toContain("data-zerops-login-remove");
  });

  it("offers Add another login under each agent only where the server keeps logins", () => {
    expect(card({ onAddLogin: noop }).match(/data-zerops-add-login=/g)).toHaveLength(2);
    expect(card()).not.toContain("data-zerops-add-login");
  });

  it("renders exactly as before when the server lists no logins", () => {
    const before = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={agents}
        viewerSubject={VIEWER}
        onSignIn={noop}
        onCancel={noop}
      />,
    );
    expect(card({ logins: [] })).toBe(before);
  });
});

describe("ended auth outcomes", () => {
  it("shows the reason and manual actions in the existing login rows", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        onSignIn={noop}
        onCancel={noop}
        onRecheck={noop}
        viewerSubject="operator"
        snapshot={snapshot([
          agent({
            agentId: "codex",
            state: "local-only",
            credPresent: true,
            verification: { status: "unknown", reason: "The login check timed out.", checkedAt: 1 },
          }),
          agent({
            agentId: "claude-code",
            state: "local-only",
            credPresent: true,
            providerAuth: "authenticated",
            registration: { status: "failed", reason: "Could not write the flag." },
          }),
        ])}
      />,
    );
    expect(html).toContain("Couldn&#x27;t verify");
    expect(html).toContain("Check again");
    expect(html).toContain("Register again");
    expect(html).toContain("Last checked");
    expect(html).toContain("The login check timed out.");
    expect(html).toContain("Could not write the flag.");
  });
});
