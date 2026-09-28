import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mateReadOnly } from "./useMateReadOnly";

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
    localSigners: {},
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
    {
      case: "an agent this browser watched the viewer sign in, not read back yet",
      input: { snapshot: snapshot(claude()), localSigners: { "claude-code": "ada" } },
      readOnly: false,
    },
    {
      case: "an agent this browser watched somebody else sign in",
      input: { snapshot: snapshot(claude()), localSigners: { "claude-code": "petra" } },
      readOnly: true,
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
