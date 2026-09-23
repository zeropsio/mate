import { EnvironmentId, type ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const feedState = vi.hoisted(() => ({
  agentAuth: undefined as unknown,
}));

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsAgentAuth: () => feedState.agentAuth,
}));

vi.mock("../../zerops/useZeropsAgentSignInDialog", () => ({
  useZeropsAgentSignInDialog: () => ({
    openFor: () => {},
    dialog: null,
    recordFailed: new Set(),
    retryRecord: () => {},
  }),
}));

vi.mock("../../zerops/useAgentLoginCancel", () => ({
  useAgentLoginCancel: () => () => {},
}));

vi.mock("../../zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => null,
}));

vi.mock("../MateMark", () => ({
  MateMark: () => null,
}));

vi.mock("./ZeropsAgentAuthCard", () => ({
  ZeropsAgentAuthRows: ({ snapshot }: { readonly snapshot: ZeropsAgentAuthSnapshot }) => (
    <ul data-zerops-agent-auth-rows>
      {snapshot.agents.map((agent) => (
        <li key={agent.agentId}>{agent.agentId}</li>
      ))}
    </ul>
  ),
}));

import type { ZeropsMateIdentity } from "../../zerops/mateIdentities";
import { ZeropsMateEmptyState } from "./ZeropsMateEmptyState";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

const MATE: ZeropsMateIdentity = {
  name: "Fen",
  tint: "olive",
  project: "Acme Docs",
  projectUrl: "https://app.zerops.io/project/p1",
  connected: true,
};

const NOT_SIGNED_IN: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

const render = () =>
  renderToStaticMarkup(
    <ZeropsMateEmptyState environmentId={ENVIRONMENT_ID} mate={MATE} threadRef={null} />,
  );

describe("ZeropsMateEmptyState", () => {
  beforeEach(() => {
    feedState.agentAuth = undefined;
  });

  it("an unread agent-auth feed never renders as nothing to sign in: it says it is checking", () => {
    feedState.agentAuth = { state: "reading", sinceMs: 0, attempt: 1 };
    const html = render();

    expect(html).toContain("Checking which coding agents are signed in…");
    expect(html).toContain("animation-delay:400ms");
    expect(html).not.toContain('data-zerops-surface="mate-sign-in"');
  });

  it("a failed agent-auth read says why", () => {
    feedState.agentAuth = {
      state: "failed",
      failure: { kind: "unsupported", capability: "subscribeZeropsAgentAuth" },
      atMs: 0,
      attempt: 1,
      retryAtMs: null,
    };

    expect(render()).toContain("This Mate is too old for this. Updating it adds it.");
  });

  it("a known snapshot with no agent signed in asks for a sign-in, stale or not", () => {
    const read: Known<ZeropsAgentAuthSnapshot> = {
      state: "known",
      value: NOT_SIGNED_IN,
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: null },
        sinceMs: 0,
      },
    };
    feedState.agentAuth = read;
    const html = render();

    expect(html).toContain('data-zerops-surface="mate-sign-in"');
    expect(html).toContain("data-zerops-agent-auth-rows");
    expect(html).not.toContain("Checking which coding agents are signed in…");
  });
});
