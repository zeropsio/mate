import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import type { LoginDigest } from "@t3tools/shared/mateLink";
import { describe, expect, it } from "vite-plus/test";

import { mateLoginsReadOnly, mateReadOnly } from "./useMateReadOnly";

const claude = (overrides: Partial<ZeropsAgentAuth> = {}): ZeropsAgentAuth => ({
  agentId: "claude-code",
  credPresent: true,
  flagOAuth: true,
  flagToken: false,
  providerAuth: "authenticated",
  state: "authorized",
  ...overrides,
});

const snapshot = (...agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents,
});

describe("mateReadOnly — whether the viewer only reads a Mate's conversation (D6)", () => {
  const base = {
    snapshot: snapshot(claude({ authorizedBy: { subject: "petra" } })),
    instanceId: "claudeAgent",
    viewerSubject: "ada",
  } as const;

  it.each([
    { case: "an agent another member signed in", input: {}, readOnly: true },
    {
      case: "an agent the viewer signed in",
      input: { snapshot: snapshot(claude({ authorizedBy: { subject: "ada" } })) },
      readOnly: false,
    },
    {
      case: "an agent the project's token signed in",
      input: {
        snapshot: snapshot(claude({ flagToken: true, authorizedBy: { subject: "petra" } })),
      },
      readOnly: false,
    },
    {
      case: "an agent whose sign-in nobody recorded",
      input: { snapshot: snapshot(claude()) },
      readOnly: false,
    },
    { case: "an agent whose sign-in is not read yet", input: { snapshot: null }, readOnly: false },
    {
      case: "a conversation on an agent this product signs nobody in to",
      input: { instanceId: "opencode" },
      readOnly: false,
    },
    {
      case: "a viewer nobody can name",
      input: { viewerSubject: undefined },
      readOnly: false,
    },
  ])("$case: $readOnly", ({ input, readOnly }) => {
    expect(mateReadOnly({ ...base, ...input })).toBe(readOnly);
  });
});

describe("mateLoginsReadOnly — the same rule over the logins HQ holds of a Mate", () => {
  const login = (overrides: Partial<LoginDigest> = {}): LoginDigest => ({
    signedInBy: "petra",
    present: true,
    token: false,
    ...overrides,
  });
  const base = {
    logins: { "claude-code": login() },
    instanceId: "claudeAgent",
    viewerSubject: "ada",
  } as const;

  it.each([
    { case: "an agent another member signed in", input: {}, readOnly: true },
    {
      case: "an agent the viewer signed in",
      input: { logins: { "claude-code": login({ signedInBy: "ada" }) } },
      readOnly: false,
    },
    {
      case: "an agent the project's token signed in",
      input: { logins: { "claude-code": login({ token: true }) } },
      readOnly: false,
    },
    {
      case: "an agent whose sign-in nobody recorded",
      input: { logins: { "claude-code": login({ signedInBy: null }) } },
      readOnly: false,
    },
    {
      case: "an agent whose credential is gone",
      input: { logins: { "claude-code": login({ present: false }) } },
      readOnly: false,
    },
    { case: "a Mate whose logins HQ holds none of", input: { logins: undefined }, readOnly: false },
    {
      case: "a conversation whose agent is not known yet",
      input: { instanceId: undefined },
      readOnly: false,
    },
    {
      case: "a viewer nobody can name",
      input: { viewerSubject: undefined },
      readOnly: false,
    },
  ])("$case: $readOnly", ({ input, readOnly }) => {
    expect(mateLoginsReadOnly({ ...base, ...input })).toBe(readOnly);
  });
});
