import { describe, expect, it } from "vite-plus/test";

import { classifyZeropsAgentAuth, zeropsAgentUnavailableReason } from "./zeropsAgentAuth.ts";

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
    "%s names the agent and where to act",
    (kind) => {
      const reason = zeropsAgentUnavailableReason("codex", kind);
      expect(reason).toContain("Codex");
      if (kind !== "registering") expect(reason).toContain("Zerops panel");
    },
  );
});
