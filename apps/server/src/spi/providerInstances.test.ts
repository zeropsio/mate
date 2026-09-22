import { describe, expect, it } from "@effect/vitest";
import type { ServerProviderAuthStatus } from "@t3tools/contracts";

import { agentDefaultInstanceId, providerAuthDisagrees } from "./providerInstances.ts";

describe("agentDefaultInstanceId", () => {
  it("maps claude-code to the claudeAgent driver's default instance", () => {
    expect(agentDefaultInstanceId("claude-code")).toBe("claudeAgent");
  });

  it("maps codex to the codex driver's default instance", () => {
    expect(agentDefaultInstanceId("codex")).toBe("codex");
  });
});

describe("providerAuthDisagrees", () => {
  const codex = agentDefaultInstanceId("codex");
  const snapshot = (status: ServerProviderAuthStatus) => [{ instanceId: codex, auth: { status } }];

  it.each([
    {
      name: "picker still says signed out after a verified sign-in",
      providers: snapshot("unauthenticated"),
      verified: "authenticated",
      expected: true,
    },
    {
      name: "picker still says signed in after a verified sign-out",
      providers: snapshot("authenticated"),
      verified: "unauthenticated",
      expected: true,
    },
    {
      name: "picker already agrees",
      providers: snapshot("authenticated"),
      verified: "authenticated",
      expected: false,
    },
    {
      name: "picker snapshot is still pending its own probe",
      providers: snapshot("unknown"),
      verified: "authenticated",
      expected: false,
    },
    {
      name: "the agent's own check could not answer",
      providers: snapshot("unauthenticated"),
      verified: "unknown",
      expected: false,
    },
    {
      name: "no instance of that driver is configured",
      providers: [],
      verified: "authenticated",
      expected: false,
    },
  ] as const)("$name", ({ providers, verified, expected }) => {
    expect(providerAuthDisagrees(providers, codex, verified)).toBe(expected);
  });
});
