import { describe, expect, it } from "vite-plus/test";

import {
  classifyZeropsAgentAuth,
  isAgentWithoutSignInReady,
  isProviderReadyToRun,
  zeropsAgentUnavailableReason,
  zeropsLoginTitle,
  zeropsLoginUnavailableReason,
  latestSucceededSignIn,
} from "./zeropsAgentAuth.ts";

// The platform flag decides, as everywhere in Zerops; the agent CLI's own
// check only turns a set flag into "sign in again".
describe("classifyZeropsAgentAuth", () => {
  it.each([
    ["authorized", "unknown", { kind: "authorized", token: false }],
    ["authorized", "authenticated", { kind: "authorized", token: false }],
    ["authorized", "unauthenticated", { kind: "needs-reauth" }],
    ["authorized-token", "unknown", { kind: "authorized", token: true }],
    ["authorized-token", "unauthenticated", { kind: "needs-reauth" }],
    ["local-only", "authenticated", { kind: "registering" }],
    ["local-only", "unknown", { kind: "registering" }],
    ["local-only", "unauthenticated", { kind: "needs-reauth" }],
    ["reconnect", "authenticated", { kind: "reconnect" }],
    ["not-authorized", "authenticated", { kind: "not-authorized" }],
  ] as const)("%s + check %s", (state, providerAuth, expected) => {
    expect(classifyZeropsAgentAuth({ state, providerAuth, credPresent: true })).toEqual(expected);
  });
});

describe("zeropsAgentUnavailableReason", () => {
  it.each(["registering", "reconnect", "needs-reauth", "not-authorized"] as const)(
    "%s names the agent and never a specific place to act",
    (kind) => {
      const reason = zeropsAgentUnavailableReason("codex", kind);
      expect(reason).toContain("Codex");
      // The model picker offers sign-in itself now, so the copy that also
      // doubles as the server's own turnRefusal text must not send everyone
      // to a specific surface.
      expect(reason).not.toContain("Zerops panel");
    },
  );

  it.each([
    [
      "registering",
      "Codex is signed in and being registered with Zerops. It will be ready in a moment.",
    ],
    [
      "reconnect",
      "Codex is signed in on this project, but this container has no login for it (it was rebuilt). Sign in again.",
    ],
    ["needs-reauth", "Codex's login on this project no longer works. Sign in again."],
    ["not-authorized", "Codex is not signed in on this project. Sign it in to use it."],
  ] as const)("%s reads exactly", (kind, expected) => {
    expect(zeropsAgentUnavailableReason("codex", kind)).toBe(expected);
  });
});

describe("zeropsLoginTitle", () => {
  it.each([
    [{ agent: "claude-code", kind: "subscription", label: "" }, "Claude Code"],
    [{ agent: "codex", kind: "subscription", label: "" }, "Codex"],
    [{ agent: "claude-code", kind: "subscription", label: "work" }, "Claude Code · work"],
    [{ agent: "codex", kind: "subscription", label: "work" }, "Codex · work"],
    [{ agent: "claude-code", kind: "apiKey", label: "" }, "Claude API key"],
    [{ agent: "claude-code", kind: "apiKey", label: "team" }, "Claude API key · team"],
  ] as const)("%o reads %s", (login, title) => {
    expect(zeropsLoginTitle(login)).toBe(title);
  });
});

describe("zeropsLoginUnavailableReason", () => {
  const work = {
    agent: "claude-code",
    kind: "subscription",
    label: "work",
    default: false,
  } as const;

  it.each(["registering", "reconnect", "needs-reauth", "not-authorized"] as const)(
    "a default login reads as its agent does (%s)",
    (kind) => {
      expect(
        zeropsLoginUnavailableReason(
          { agent: "codex", kind: "subscription", label: "", default: true },
          kind,
        ),
      ).toBe(zeropsAgentUnavailableReason("codex", kind));
    },
  );

  it.each([
    [
      "registering",
      work,
      "Claude Code · work is signed in and being checked. It will be ready in a moment.",
    ],
    [
      "needs-reauth",
      work,
      "Claude Code · work's login on this project no longer works. Sign in again.",
    ],
    [
      "reconnect",
      work,
      "Claude Code · work's login on this project no longer works. Sign in again.",
    ],
    [
      "not-authorized",
      work,
      "Claude Code · work is not signed in on this project. Sign it in to use it.",
    ],
    [
      "not-authorized",
      { agent: "claude-code", kind: "apiKey", label: "", default: false },
      "Claude API key has no key stored on this project. Add it again.",
    ],
  ] as const)("another login, %s, names the login", (kind, login, expected) => {
    expect(zeropsLoginUnavailableReason(login, kind)).toBe(expected);
  });
});

// The latest sign-in that succeeded, whatever was started after it: an attempt started and
// cancelled, or failed, before its record landed changes nothing (Eva signs in, Jan starts and
// cancels a sign-in before her tag lands).
describe("latestSucceededSignIn", () => {
  const at = "2026-09-30T21:38:00.000Z";
  it.each([
    { name: "no login", login: undefined, expected: undefined },
    {
      name: "a login that succeeded",
      login: { phase: "succeeded", startedAt: at, startedBy: "eva" },
      expected: { startedAt: at, startedBy: "eva" },
    },
    {
      name: "one under way, nothing succeeded before it",
      login: { phase: "menu", startedAt: at, startedBy: "jan" },
      expected: undefined,
    },
    {
      name: "one cancelled after a success",
      login: {
        phase: "cancelled",
        startedAt: "2026-09-30T21:38:20.000Z",
        startedBy: "jan",
        lastSucceeded: { startedAt: at, startedBy: "eva" },
      },
      expected: { startedAt: at, startedBy: "eva" },
    },
  ] as const)("$name", ({ login, expected }) => {
    expect(latestSucceededSignIn(login)).toEqual(expected);
  });
});

// One readiness test, the browser's and the server's: an instance a turn can start on.
describe("isProviderReadyToRun / isAgentWithoutSignInReady", () => {
  const MODELS = [{ slug: "m" }];
  const instance = (overrides: Record<string, unknown> = {}) => ({
    driver: "cursor",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: MODELS,
    ...overrides,
  });
  it.each([
    { name: "a ready, signed-in Cursor with models", over: {}, ready: true, other: true },
    { name: "turned off", over: { enabled: false }, ready: false, other: false },
    { name: "not installed", over: { installed: false }, ready: false, other: false },
    {
      name: "unavailable on this server",
      over: { availability: "unavailable" },
      ready: false,
      other: false,
    },
    { name: "not ready", over: { status: "warning" }, ready: false, other: false },
    {
      name: "signed out",
      over: { auth: { status: "unauthenticated" } },
      ready: false,
      other: false,
    },
    // Grok and Cursor can say ready with a sign-in they could not read: not one to count on.
    {
      name: "ready, its sign-in unknown",
      over: { auth: { status: "unknown" } },
      ready: true,
      other: false,
    },
    { name: "listing no models", over: { models: [] }, ready: false, other: false },
    // Claude Code and Codex: the feed answers for them, never this.
    { name: "Claude Code", over: { driver: "claudeAgent" }, ready: true, other: false },
    { name: "Codex", over: { driver: "codex" }, ready: true, other: false },
    { name: "OpenCode", over: { driver: "opencode" }, ready: true, other: true },
    { name: "Grok", over: { driver: "grok" }, ready: true, other: true },
    { name: "Antigravity", over: { driver: "antigravity" }, ready: true, other: true },
  ])("$name: ready $ready, an agent without sign-in $other", ({ over, ready, other }) => {
    const provider = instance(over) as unknown as Parameters<typeof isProviderReadyToRun>[0];
    expect(isProviderReadyToRun(provider)).toBe(ready);
    expect(isAgentWithoutSignInReady(provider)).toBe(other);
  });
});
