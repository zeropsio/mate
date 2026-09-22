import { describe, expect, it } from "vite-plus/test";
import type {
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentLoginState,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  agentAuthAction,
  agentAuthLabel,
  agentLoginLabel,
  agentLoginTerminalToFocus,
  classifyAgentLogin,
  classifyAgentRowLogin,
  zeropsAgentAuthNeedsAttention,
  zeropsAgentSignInRequired,
} from "./agentLogin.ts";

const agent = (
  overrides: Partial<ZeropsAgentAuth> & { agentId: "claude-code" | "codex" },
): ZeropsAgentAuth => ({
  credPresent: false,
  flagOAuth: false,
  flagToken: false,
  state: "not-authorized",
  providerAuth: "unknown",
  ...overrides,
});

// The platform flag decides (`@t3tools/shared/zeropsAgentAuth`); the agent
// CLI's own check only turns a set flag into "sign in again".
describe("agentAuthLabel / agentAuthAction", () => {
  const REAUTH = "Its login no longer works — sign in again";
  it.each([
    ["not-authorized", "authenticated", "Not signed in", "sign-in"],
    ["not-authorized", "unknown", "Not signed in", "sign-in"],
    ["reconnect", "authenticated", "This container has no login for it — sign in again", "sign-in"],
    ["reconnect", "unknown", "This container has no login for it — sign in again", "sign-in"],
    ["authorized", "authenticated", "Authorized", "none"],
    // Set flag, check not answered yet: signed in, nothing waits on it.
    ["authorized", "unknown", "Authorized", "none"],
    ["authorized", "unauthenticated", REAUTH, "sign-in"],
    ["authorized-token", "authenticated", "Authorized (token)", "none"],
    ["authorized-token", "unauthenticated", REAUTH, "sign-in"],
    // Signed in in the container, the flag not written yet.
    ["local-only", "authenticated", "Signed in — registering with Zerops…", "registering"],
    ["local-only", "unknown", "Signed in — registering with Zerops…", "registering"],
    ["local-only", "unauthenticated", REAUTH, "sign-in"],
  ] as const)("%s + provider %s: %s", (state, providerAuth, label, action) => {
    const a = agent({ agentId: "claude-code", state, credPresent: true, providerAuth });
    expect(agentAuthLabel(a)).toBe(label);
    expect(agentAuthAction(a)).toBe(action);
  });
});

const loginState = (
  overrides: Partial<ZeropsAgentLoginState> & { phase: ZeropsAgentLoginState["phase"] },
): ZeropsAgentLoginState => ({
  terminalId: "agent-login-claude-code",
  startedAt: "2026-08-29T12:00:00.000Z" as unknown as ZeropsAgentLoginState["startedAt"],
  startedBy: "user-a",
  ...overrides,
});

describe("classifyAgentLogin / agentLoginLabel", () => {
  it("no session: none", () => {
    expect(classifyAgentLogin(undefined)).toEqual({ kind: "none" });
  });

  it("cancelled: treated the same as no session", () => {
    expect(classifyAgentLogin(loginState({ phase: "cancelled" }))).toEqual({ kind: "none" });
  });

  it("starting / menu: their own kind, no url/code carried", () => {
    expect(classifyAgentLogin(loginState({ phase: "starting" }))).toEqual({ kind: "starting" });
    expect(classifyAgentLogin(loginState({ phase: "menu" }))).toEqual({ kind: "menu" });
    expect(agentLoginLabel({ kind: "menu" })).toBe("Choosing “Claude account with subscription”…");
  });

  it("awaiting-browser: carries url and code through", () => {
    const presentation = classifyAgentLogin(
      loginState({
        phase: "awaiting-browser",
        url: "https://example.com/auth",
        code: "ABCD-12345",
      }),
    );
    expect(presentation).toEqual({
      kind: "awaiting-browser",
      url: "https://example.com/auth",
      code: "ABCD-12345",
    });
  });

  it("awaiting-code: its own kind, labeled to paste the code", () => {
    expect(classifyAgentLogin(loginState({ phase: "awaiting-code" }))).toEqual({
      kind: "awaiting-code",
    });
    expect(agentLoginLabel({ kind: "awaiting-code" })).toBe("Paste the code from your browser");
  });

  it("verifying-code: its own kind, labeled as the check it is", () => {
    expect(classifyAgentLogin(loginState({ phase: "verifying-code" }))).toEqual({
      kind: "verifying-code",
    });
    expect(agentLoginLabel({ kind: "verifying-code" })).toBe("Checking the code…");
  });

  it("succeeded: labeled Authorized", () => {
    expect(classifyAgentLogin(loginState({ phase: "succeeded" }))).toEqual({ kind: "succeeded" });
    expect(agentLoginLabel({ kind: "succeeded" })).toBe("Authorized");
  });

  it("failed: carries the message through, falls back when absent", () => {
    expect(classifyAgentLogin(loginState({ phase: "failed", message: "nope" }))).toEqual({
      kind: "failed",
      message: "nope",
    });
    expect(agentLoginLabel({ kind: "failed", message: "nope" })).toBe("nope");
    expect(agentLoginLabel({ kind: "failed", message: undefined })).toBe("Sign-in failed");
  });
});

/**
 * The pure half of the terminal-focus fix (S7 fix2 finding 3): the second
 * login session's terminal tab opened unfocused, showing an empty shell
 * while the card said "Waiting for you to finish signing in". Deriving
 * "what terminal id should now be focused" from the `zerops.agentLogin.start`
 * RPC result is the part `useAgentLogin.ts` (untested by convention) can
 * delegate to something this file can pin.
 */
describe("classifyAgentRowLogin", () => {
  const authorized = {
    state: "authorized",
    credPresent: true,
    providerAuth: "authenticated",
  } as const;
  const signedOut = {
    state: "not-authorized",
    credPresent: false,
    providerAuth: "unauthenticated",
  } as const;

  it.each([
    {
      name: "a login still running is the row's subject",
      phase: "verifying-code",
      auth: signedOut,
      kind: "verifying-code",
    },
    {
      name: "a success steps aside for the verified status",
      phase: "succeeded",
      auth: authorized,
      kind: "none",
    },
    {
      name: "a success does not outlive a sign-out",
      phase: "succeeded",
      auth: signedOut,
      kind: "none",
    },
    {
      name: "a success whose check has not answered is confirming, never signed out",
      phase: "succeeded",
      auth: { state: "not-authorized", credPresent: false, providerAuth: "unknown" },
      kind: "confirming",
    },
    {
      name: "a failure stays while the agent is still signed out",
      phase: "failed",
      auth: signedOut,
      kind: "failed",
    },
    {
      name: "a failure steps aside once the agent is signed in after all",
      phase: "failed",
      auth: authorized,
      kind: "none",
    },
  ] as const)("$name", ({ phase, auth, kind }) => {
    expect(
      classifyAgentRowLogin(
        agent({ agentId: "claude-code", ...auth, login: loginState({ phase }) }),
      ).kind,
    ).toBe(kind);
  });
});

describe("agentLoginTerminalToFocus", () => {
  it("a successful start focuses the session's own terminalId", () => {
    const result = AsyncResult.success({ terminalId: "agent-login-claude-code" });
    expect(agentLoginTerminalToFocus(result)).toBe("agent-login-claude-code");
  });

  it("a failed start focuses nothing", () => {
    const result = AsyncResult.fail(new Error("boom"));
    expect(agentLoginTerminalToFocus(result)).toBeUndefined();
  });
});

const snapshot = (agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents,
});

describe("zeropsAgentAuthNeedsAttention", () => {
  it("is false when the feed is not available", () => {
    expect(zeropsAgentAuthNeedsAttention({ available: false, agents: [] })).toBe(false);
  });

  it("is false when every agent is authorized and the provider agrees", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
          }),
          agent({
            agentId: "codex",
            state: "authorized-token",
            credPresent: true,
            providerAuth: "authenticated",
          }),
        ]),
      ),
    ).toBe(false);
  });

  it("is true when at least one agent is not authorized", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
          }),
          agent({ agentId: "codex", state: "reconnect" }),
        ]),
      ),
    ).toBe(true);
  });

  /**
   * The case the addendum exists for: the local state matrix says
   * "authorized", but the live provider check disagrees. That disagreement
   * has to surface the card, or the user never learns they need to re-auth.
   */
  it("is true when the state matrix says authorized but the provider disagrees", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "claude-code",
            state: "authorized",
            credPresent: true,
            providerAuth: "unauthenticated",
          }),
        ]),
      ),
    ).toBe(true);
  });

  it("is true when an agent has an active login session even though its baseline state is authorized", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "codex",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
            login: loginState({ phase: "menu" }),
          }),
        ]),
      ),
    ).toBe(true);
  });

  // A succeeded session stays in the feed until the next start: it must not
  // keep the card up once the agent is authorized, nor outlive a sign-out.
  it("is false when the only login session present succeeded and the agent is authorized", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "codex",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
            login: loginState({ phase: "succeeded" }),
          }),
        ]),
      ),
    ).toBe(false);
  });

  it("is false when the only login session present is cancelled and everything else is authorized", () => {
    expect(
      zeropsAgentAuthNeedsAttention(
        snapshot([
          agent({
            agentId: "codex",
            state: "authorized",
            credPresent: true,
            providerAuth: "authenticated",
            login: loginState({ phase: "cancelled" }),
          }),
        ]),
      ),
    ).toBe(false);
  });
});

/**
 * The band below the thread header asks for a sign-in only when the
 * environment has no agent to run at all. One authorized agent is enough to
 * work; the other agent's row stays the panel card's business.
 */
describe("zeropsAgentSignInRequired", () => {
  const authorizedClaude = agent({
    agentId: "claude-code",
    state: "authorized",
    credPresent: true,
    providerAuth: "authenticated",
  });

  it.each([
    {
      name: "the feed is not available",
      snapshot: { available: false, agents: [] },
      expected: false,
    },
    { name: "the feed has not listed any agent yet", snapshot: snapshot([]), expected: false },
    {
      name: "one agent is authorized and the other is not signed in",
      snapshot: snapshot([authorizedClaude, agent({ agentId: "codex", state: "not-authorized" })]),
      expected: false,
    },
    {
      name: "one agent is authorized and the other needs a reconnect",
      snapshot: snapshot([authorizedClaude, agent({ agentId: "codex", state: "reconnect" })]),
      expected: false,
    },
    {
      name: "one agent is authorized and the other is mid-login",
      snapshot: snapshot([
        authorizedClaude,
        agent({ agentId: "codex", state: "not-authorized", login: loginState({ phase: "menu" }) }),
      ]),
      expected: false,
    },
    {
      name: "the only agent's credential is present but the provider check has not answered",
      snapshot: snapshot([
        agent({
          agentId: "claude-code",
          state: "authorized",
          credPresent: true,
          providerAuth: "unknown",
        }),
      ]),
      expected: false,
    },
    {
      name: "no agent is signed in",
      snapshot: snapshot([
        agent({ agentId: "claude-code", state: "not-authorized" }),
        agent({ agentId: "codex", state: "not-authorized" }),
      ]),
      expected: true,
    },
    {
      name: "the only authorized-looking agent is rejected by its provider",
      snapshot: snapshot([
        agent({
          agentId: "claude-code",
          state: "authorized",
          credPresent: true,
          providerAuth: "unauthenticated",
        }),
        agent({ agentId: "codex", state: "reconnect" }),
      ]),
      expected: true,
    },
    {
      name: "no agent is signed in and one login is in flight",
      snapshot: snapshot([
        agent({
          agentId: "claude-code",
          state: "not-authorized",
          login: loginState({ phase: "awaiting-browser" }),
        }),
        agent({ agentId: "codex", state: "not-authorized" }),
      ]),
      expected: true,
    },
  ])("is $expected when $name", ({ snapshot: input, expected }) => {
    expect(zeropsAgentSignInRequired(input)).toBe(expected);
  });
});
