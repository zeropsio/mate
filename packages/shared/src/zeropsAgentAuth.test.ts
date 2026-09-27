import { describe, expect, it } from "vite-plus/test";

import {
  classifyZeropsAgentAuth,
  zeropsAgentUnavailableReason,
  zeropsLoginTitle,
  zeropsLoginUnavailableReason,
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
