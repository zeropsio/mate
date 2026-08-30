import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ZeropsAgentAuthSnapshot,
  type ZeropsTopologySnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const feedState = vi.hoisted(() => ({
  topology: undefined as ZeropsTopologySnapshot | undefined,
}));

const actions = vi.hoisted(() => ({
  cancel: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsTopology: () => feedState.topology,
  useZeropsLifecycle: () => undefined,
  useZeropsAgentAuth: () => {
    throw new Error("ZeropsPanel must not consult the agent-auth feed");
  },
}));

vi.mock("../../zerops/useAgentLogin", () => ({
  useAgentLogin: () => actions.signIn,
}));

vi.mock("../../zerops/useAgentLoginCancel", () => ({
  useAgentLoginCancel: () => actions.cancel,
}));

import { ZeropsPanel, ZeropsPanelPlaceholder } from "./ZeropsPanel";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const TOPOLOGY: ZeropsTopologySnapshot = {
  available: true,
  degraded: false,
  services: [],
  warnings: [],
  readAt: DateTime.makeUnsafe("2026-08-30T12:00:00.000Z"),
};

const AGENT_AUTH: ZeropsAgentAuthSnapshot = {
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

/**
 * The map is absent for two different reasons and they must not share a
 * sentence. The panel's tab is persisted per thread, so a reload renders this
 * surface before the first snapshot arrives — and "not a Zerops project" then
 * is a confident lie about the very project the user is looking at, told for
 * the second or so before the feed answers.
 */
describe("ZeropsPanelPlaceholder", () => {
  it("says it is still reading while the first snapshot is in flight", () => {
    const html = renderToStaticMarkup(<ZeropsPanelPlaceholder waiting />);

    expect(html).toContain("Reading the project");
    expect(html).not.toContain("not a Zerops project");
  });

  it("says there is no Zerops here only once the feed has answered", () => {
    const html = renderToStaticMarkup(<ZeropsPanelPlaceholder waiting={false} />);

    expect(html).toContain("This environment is not a Zerops project.");
    expect(html).not.toContain("Reading the project");
  });
});

describe("ZeropsPanel agent authorization ownership", () => {
  it.each([
    {
      name: "no card when handed null even though the auth feed reports attention",
      agentAuthCard: null,
      topology: TOPOLOGY,
      rendersCard: false,
    },
    {
      name: "a resolver-owned snapshot",
      agentAuthCard: AGENT_AUTH,
      topology: TOPOLOGY,
      rendersCard: true,
    },
    {
      name: "a resolver-owned snapshot before topology answers",
      agentAuthCard: AGENT_AUTH,
      topology: undefined,
      rendersCard: true,
    },
  ])("renders the card=$rendersCard with $name", ({ agentAuthCard, topology, rendersCard }) => {
    feedState.topology = topology;
    const html = renderToStaticMarkup(
      <ZeropsPanel agentAuthCard={agentAuthCard} threadRef={THREAD_REF} />,
    );

    expect(html.includes("data-zerops-agent-auth-card")).toBe(rendersCard);
  });
});
