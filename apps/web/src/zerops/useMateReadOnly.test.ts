import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId } from "@t3tools/contracts";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { useMateReadOnly } from "./useMateReadOnly";

const facts = vi.hoisted(() => ({
  read: undefined as Known<ZeropsAgentAuthSnapshot> | undefined,
  viewerSubject: undefined as string | undefined,
}));
vi.mock("./useZeropsFeeds", () => ({ useZeropsAgentAuth: () => facts.read }));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({ user: { id: facts.viewerSubject } }),
}));

function Reader({ instanceId }: { instanceId: string | undefined }) {
  return String(useMateReadOnly(EnvironmentId.make("rig"), instanceId));
}

// Decision: admission does not invent signer ownership. Drop unrecorded-login and any blocking derived from who signed in.
const mateReadOnly = (input: {
  snapshot: ZeropsAgentAuthSnapshot | null;
  instanceId: string | undefined;
  viewerSubject: string | undefined;
}) => {
  facts.read =
    input.snapshot === null
      ? undefined
      : {
          state: "known",
          value: input.snapshot,
          asOf: { ordinal: 1, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "live" },
        };
  facts.viewerSubject = input.viewerSubject;
  return renderToStaticMarkup(createElement(Reader, { instanceId: input.instanceId })) === "true";
};

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
    { case: "an agent another member signed in", input: {}, readOnly: false },
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
