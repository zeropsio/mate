import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  ZEROPS_AGENT_LOGIN_COMMANDS,
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
  ZeropsAgentLoginCancelInput,
  ZeropsAgentLoginPhase,
  ZeropsAgentLoginStartInput,
  ZeropsAgentLoginStartResult,
  ZeropsAgentLoginState,
} from "./zerops.ts";

const decodeAgentId = Schema.decodeUnknownSync(ZeropsAgentId);
const decodeAgentAuthState = Schema.decodeUnknownSync(ZeropsAgentAuthState);
const decodeAgentAuth = Schema.decodeUnknownSync(ZeropsAgentAuth);
const decodeSnapshot = Schema.decodeUnknownSync(ZeropsAgentAuthSnapshot);
const decodeLoginPhase = Schema.decodeUnknownSync(ZeropsAgentLoginPhase);
const decodeLoginState = Schema.decodeUnknownSync(ZeropsAgentLoginState);
const decodeLoginStartInput = Schema.decodeUnknownSync(ZeropsAgentLoginStartInput);
const decodeLoginStartResult = Schema.decodeUnknownSync(ZeropsAgentLoginStartResult);
const decodeLoginCancelInput = Schema.decodeUnknownSync(ZeropsAgentLoginCancelInput);

describe("ZeropsAgentId", () => {
  it("accepts the two agents with a live-verified credential probe", () => {
    expect(decodeAgentId("claude-code")).toBe("claude-code");
    expect(decodeAgentId("codex")).toBe("codex");
  });

  it("rejects an agent with no verified probe", () => {
    expect(() => decodeAgentId("cursor")).toThrow();
  });
});

describe("ZeropsAgentAuthState", () => {
  it("accepts every value of the §3 W-STATE matrix", () => {
    for (const state of [
      "authorized-token",
      "authorized",
      "reconnect",
      "local-only",
      "not-authorized",
    ]) {
      expect(decodeAgentAuthState(state)).toBe(state);
    }
  });

  it("rejects a value outside the matrix", () => {
    expect(() => decodeAgentAuthState("pending")).toThrow();
  });
});

describe("ZeropsAgentAuth", () => {
  it("decodes one agent's row", () => {
    const decoded = decodeAgentAuth({
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
    });
    expect(decoded.agentId).toBe("claude-code");
    expect(decoded.state).toBe("authorized");
    expect(decoded.providerAuth).toBe("authenticated");
  });

  it("accepts every ServerProviderAuthStatus value for providerAuth", () => {
    for (const providerAuth of ["authenticated", "unauthenticated", "unknown"]) {
      const decoded = decodeAgentAuth({
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        providerAuth,
        state: "not-authorized",
      });
      expect(decoded.providerAuth).toBe(providerAuth);
    }
  });

  it("rejects a missing providerAuth field", () => {
    expect(() =>
      decodeAgentAuth({
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        state: "not-authorized",
      }),
    ).toThrow();
  });
});

describe("ZeropsAgentAuthSnapshot", () => {
  it("decodes an available snapshot with both agents", () => {
    const decoded = decodeSnapshot({
      available: true,
      agents: [
        {
          agentId: "claude-code",
          credPresent: false,
          flagOAuth: false,
          flagToken: false,
          providerAuth: "unknown",
          state: "not-authorized",
        },
        {
          agentId: "codex",
          credPresent: true,
          flagOAuth: false,
          flagToken: false,
          providerAuth: "unauthenticated",
          state: "local-only",
        },
      ],
    });
    expect(decoded.agents).toHaveLength(2);
    expect(decoded.reason).toBeUndefined();
  });

  it("decodes an unavailable snapshot (not a Zerops environment)", () => {
    const decoded = decodeSnapshot({
      available: false,
      reason: "Not a Zerops environment",
      agents: [],
    });
    expect(decoded.available).toBe(false);
    expect(decoded.agents).toEqual([]);
  });
});

describe("ZEROPS_AGENT_LOGIN_COMMANDS", () => {
  it("has exactly one command per known agent", () => {
    expect(ZEROPS_AGENT_LOGIN_COMMANDS["claude-code"]).toBe("claude /login");
    expect(ZEROPS_AGENT_LOGIN_COMMANDS.codex).toBe("codex login --device-auth");
  });
});

describe("ZeropsAgentLoginPhase", () => {
  it("accepts every phase of the login walker", () => {
    for (const phase of [
      "starting",
      "menu",
      "awaiting-browser",
      "awaiting-code",
      "verifying-code",
      "succeeded",
      "failed",
      "cancelled",
    ]) {
      expect(decodeLoginPhase(phase)).toBe(phase);
    }
  });

  it("rejects a phase outside the walker's vocabulary", () => {
    expect(() => decodeLoginPhase("waiting_for_code")).toThrow();
  });
});

describe("ZeropsAgentLoginState", () => {
  it("decodes the minimal starting state", () => {
    const decoded = decodeLoginState({
      phase: "starting",
      terminalId: "agent-login-claude-code",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    });
    expect(decoded.phase).toBe("starting");
    expect(decoded.url).toBeUndefined();
    expect(decoded.code).toBeUndefined();
  });

  it("decodes an awaiting-browser state carrying a url and a device code", () => {
    const decoded = decodeLoginState({
      phase: "awaiting-browser",
      url: "https://auth.openai.com/codex/device",
      code: "ABCD-12345",
      terminalId: "agent-login-codex",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    });
    expect(decoded.url).toBe("https://auth.openai.com/codex/device");
    expect(decoded.code).toBe("ABCD-12345");
  });

  it("decodes a failed state carrying a message", () => {
    const decoded = decodeLoginState({
      phase: "failed",
      message: "Authentication failed.",
      terminalId: "agent-login-claude-code",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    });
    expect(decoded.message).toBe("Authentication failed.");
  });

  // A Mate keeps the version it was installed with while the hosted client
  // moves on: a state from before `startedBy` must still decode, or the whole
  // agent-auth snapshot fails and the card disappears (seen on localhost
  // against a 0.11.40 container, 2026-09-22).
  it("decodes a state from a server that names no starter, and carries one when named", () => {
    const base = {
      phase: "awaiting-browser",
      terminalId: "agent-login-codex",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    } as const;
    expect(decodeLoginState(base).startedBy).toBeUndefined();
    expect(decodeLoginState({ ...base, startedBy: "user-a" }).startedBy).toBe("user-a");
  });

  it("rejects a document missing terminalId", () => {
    expect(() =>
      decodeLoginState({
        phase: "starting",
        startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
      }),
    ).toThrow();
  });
});

describe("ZeropsAgentAuth with login", () => {
  it("decodes a row carrying an active login session", () => {
    const decoded = decodeAgentAuth({
      agentId: "claude-code",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
      login: {
        phase: "menu",
        terminalId: "agent-login-claude-code",
        startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
      },
    });
    expect(decoded.login?.phase).toBe("menu");
  });

  it("decodes a row with no login field the same as before (still optional)", () => {
    const decoded = decodeAgentAuth({
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    });
    expect(decoded.login).toBeUndefined();
  });
});

describe("ZeropsAgentLoginStartInput / ZeropsAgentLoginStartResult / ZeropsAgentLoginCancelInput", () => {
  it("decodes a start input", () => {
    const decoded = decodeLoginStartInput({ agentId: "codex", threadId: "thread-1" });
    expect(decoded.agentId).toBe("codex");
    expect(decoded.threadId).toBe("thread-1");
  });

  it("rejects a start input naming an unknown agent", () => {
    expect(() => decodeLoginStartInput({ agentId: "cursor", threadId: "thread-1" })).toThrow();
  });

  it("decodes a start result", () => {
    const decoded = decodeLoginStartResult({ terminalId: "agent-login-claude-code" });
    expect(decoded.terminalId).toBe("agent-login-claude-code");
  });

  it("decodes a cancel input", () => {
    const decoded = decodeLoginCancelInput({ agentId: "claude-code" });
    expect(decoded.agentId).toBe("claude-code");
  });
});
