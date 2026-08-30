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
  zeropsAgentAuthNeedsAttention,
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

describe("agentAuthLabel / agentAuthAction", () => {
  it("not-authorized: ignores providerAuth entirely", () => {
    for (const providerAuth of ["authenticated", "unauthenticated", "unknown"] as const) {
      const a = agent({ agentId: "claude-code", state: "not-authorized", providerAuth });
      expect(agentAuthLabel(a)).toBe("Not signed in");
      expect(agentAuthAction(a)).toBe("sign-in");
    }
  });

  it("reconnect: ignores providerAuth entirely", () => {
    for (const providerAuth of ["authenticated", "unauthenticated", "unknown"] as const) {
      const a = agent({ agentId: "codex", state: "reconnect", providerAuth });
      expect(agentAuthLabel(a)).toBe("Reconnect needed — sign in again");
      expect(agentAuthAction(a)).toBe("sign-in");
    }
  });

  it("authorized + provider authenticated: the plain success label, no action", () => {
    const a = agent({
      agentId: "claude-code",
      state: "authorized",
      credPresent: true,
      providerAuth: "authenticated",
    });
    expect(agentAuthLabel(a)).toBe("Authorized");
    expect(agentAuthAction(a)).toBe("none");
  });

  it("authorized-token + provider authenticated: the token-flavored success label, no action", () => {
    const a = agent({
      agentId: "codex",
      state: "authorized-token",
      credPresent: true,
      providerAuth: "authenticated",
    });
    expect(agentAuthLabel(a)).toBe("Authorized (token)");
    expect(agentAuthAction(a)).toBe("none");
  });

  it("local-only + provider authenticated: the default registering label, disabled action", () => {
    const a = agent({
      agentId: "claude-code",
      state: "local-only",
      credPresent: true,
      providerAuth: "authenticated",
    });
    expect(agentAuthLabel(a)).toBe("Signed in on the container — registering with Zerops…");
    expect(agentAuthAction(a)).toBe("registering");
  });

  /**
   * The local state matrix (state) and the live provider check (providerAuth)
   * can disagree — a credential file that is present but expired, revoked, or
   * belongs to a signed-out account. providerAuth wins: this is still
   * something the user must act on, from both `authorized*` and `local-only`.
   */
  it("authorized + provider unauthenticated: re-auth label, enabled sign-in", () => {
    const a = agent({
      agentId: "claude-code",
      state: "authorized",
      credPresent: true,
      providerAuth: "unauthenticated",
    });
    expect(agentAuthLabel(a)).toBe(
      "Signed in on the container, but Claude/Codex reports not authenticated — sign in again",
    );
    expect(agentAuthAction(a)).toBe("sign-in");
  });

  it("authorized-token + provider unauthenticated: re-auth label, enabled sign-in", () => {
    const a = agent({
      agentId: "codex",
      state: "authorized-token",
      credPresent: true,
      providerAuth: "unauthenticated",
    });
    expect(agentAuthLabel(a)).toBe(
      "Signed in on the container, but Claude/Codex reports not authenticated — sign in again",
    );
    expect(agentAuthAction(a)).toBe("sign-in");
  });

  it("local-only + provider unauthenticated: re-auth label, enabled sign-in", () => {
    const a = agent({
      agentId: "claude-code",
      state: "local-only",
      credPresent: true,
      providerAuth: "unauthenticated",
    });
    expect(agentAuthLabel(a)).toBe(
      "Signed in on the container, but Claude/Codex reports not authenticated — sign in again",
    );
    expect(agentAuthAction(a)).toBe("sign-in");
  });

  it("authorized + provider unknown, credential present: checking, disabled action", () => {
    const a = agent({
      agentId: "claude-code",
      state: "authorized",
      credPresent: true,
      providerAuth: "unknown",
    });
    expect(agentAuthLabel(a)).toBe("Checking…");
    expect(agentAuthAction(a)).toBe("checking");
  });

  it("local-only + provider unknown, credential present: checking, disabled action", () => {
    const a = agent({
      agentId: "codex",
      state: "local-only",
      credPresent: true,
      providerAuth: "unknown",
    });
    expect(agentAuthLabel(a)).toBe("Checking…");
    expect(agentAuthAction(a)).toBe("checking");
  });
});

const loginState = (
  overrides: Partial<ZeropsAgentLoginState> & { phase: ZeropsAgentLoginState["phase"] },
): ZeropsAgentLoginState => ({
  terminalId: "agent-login-claude-code",
  startedAt: "2026-08-29T12:00:00.000Z" as unknown as ZeropsAgentLoginState["startedAt"],
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

  it("awaiting-code: its own kind, labeled to paste into the terminal", () => {
    expect(classifyAgentLogin(loginState({ phase: "awaiting-code" }))).toEqual({
      kind: "awaiting-code",
    });
    expect(agentLoginLabel({ kind: "awaiting-code" })).toBe(
      "Paste the code into the terminal below",
    );
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
