import { describe, expect, it } from "vite-plus/test";

import { buildSnapshot, computeAgentAuthState, toZembedEnv } from "./ZeropsAgentAuth.ts";

// `agentDefaultInstanceId` moved to `../spi/providerInstances.ts` (owned SPI
// capability — this module no longer imports `provider/**` at all,
// methodology §3.2); its own tests moved to `providerInstances.test.ts`.

// The §3 W-STATE matrix (docs/spec-welcome-mode.md), pinned verbatim against
// `vscode-bootstrap-welcome.js`'s `computeAgentState`. `credVerifiable` is
// dropped here: both agents this feed reports on (claude-code, codex) always
// have a verified probe, so every row already fully determines the result
// from flagToken/flagOAuth/credPresent alone — exactly as the welcome.js
// source comment says.
describe("computeAgentAuthState", () => {
  it.each([
    { flagOAuth: false, flagToken: false, credPresent: false, expected: "not-authorized" },
    { flagOAuth: false, flagToken: false, credPresent: true, expected: "local-only" },
    { flagOAuth: true, flagToken: false, credPresent: true, expected: "authorized" },
    { flagOAuth: true, flagToken: false, credPresent: false, expected: "reconnect" },
    { flagOAuth: false, flagToken: true, credPresent: false, expected: "authorized-token" },
    { flagOAuth: false, flagToken: true, credPresent: true, expected: "authorized-token" },
    // flagToken wins even when flagOAuth is also set, matching welcome.js's
    // `if (flagToken) return "authorized-token"` short-circuit before flagOAuth.
    { flagOAuth: true, flagToken: true, credPresent: false, expected: "authorized-token" },
  ])("flagOAuth=$flagOAuth flagToken=$flagToken credPresent=$credPresent -> $expected", (row) => {
    expect(computeAgentAuthState(row)).toBe(row.expected);
  });
});

const UNKNOWN_PROVIDER_AUTH = { "claude-code": "unknown", codex: "unknown" } as const;

describe("buildSnapshot", () => {
  it("reads both agents' flags from the env store by suffix, and carries providerAuth through unchanged", () => {
    const snapshot = buildSnapshot(
      { ZCP_AGENT_OAUTH_CLAUDE_CODE: "true", ZCP_AGENT_TOKEN_CODEX: "sometoken" },
      { "claude-code": true, codex: false },
      { "claude-code": "authenticated", codex: "unauthenticated" },
    );
    expect(snapshot.available).toBe(true);
    expect(snapshot.agents).toEqual([
      {
        agentId: "claude-code",
        credPresent: true,
        flagOAuth: true,
        flagToken: false,
        providerAuth: "authenticated",
        state: "authorized",
      },
      {
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: true,
        providerAuth: "unauthenticated",
        state: "authorized-token",
      },
    ]);
  });

  it("treats a missing env store as no flags set", () => {
    const snapshot = buildSnapshot(
      undefined,
      { "claude-code": false, codex: true },
      UNKNOWN_PROVIDER_AUTH,
    );
    expect(snapshot.agents.find((agent) => agent.agentId === "claude-code")?.state).toBe(
      "not-authorized",
    );
    expect(snapshot.agents.find((agent) => agent.agentId === "codex")?.state).toBe("local-only");
  });

  it('only treats the exact string "true" as the OAuth flag being set', () => {
    const snapshot = buildSnapshot(
      { ZCP_AGENT_OAUTH_CLAUDE_CODE: "false" },
      { "claude-code": false, codex: false },
      UNKNOWN_PROVIDER_AUTH,
    );
    expect(snapshot.agents.find((agent) => agent.agentId === "claude-code")?.flagOAuth).toBe(false);
  });

  it("defaults providerAuth to unknown before any provider check has run", () => {
    const snapshot = buildSnapshot(
      undefined,
      { "claude-code": false, codex: false },
      UNKNOWN_PROVIDER_AUTH,
    );
    expect(snapshot.agents.every((agent) => agent.providerAuth === "unknown")).toBe(true);
  });
});

// Spec §0, MA-7: the env store is the platform's whole service env, secrets
// included. The reader keeps the two agent-flag prefixes and nothing else, so
// no other value of that file ever sits in this module's memory.
describe("toZembedEnv", () => {
  it("keeps only the agent flag keys; a store carrying ZCP_API_KEY and VSCODE_PASSWORD yields neither", () => {
    expect(
      toZembedEnv({
        ZCP_AGENT_OAUTH_CLAUDE: "true",
        ZCP_AGENT_TOKEN_CODEX: "tok",
        ZCP_API_KEY: "secret",
        VSCODE_PASSWORD: "pw",
        hostname: "zcp",
        ZCP_AGENT_OAUTH_NUMERIC: 1,
      }),
    ).toEqual({ ZCP_AGENT_OAUTH_CLAUDE: "true", ZCP_AGENT_TOKEN_CODEX: "tok" });
  });

  it.each([null, [], "x", 1, undefined])("reads a non-object document (%s) as no store", (doc) => {
    expect(toZembedEnv(doc)).toBeUndefined();
  });
});
