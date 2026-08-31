import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ZeropsAgentAuthSnapshot,
  type ZeropsTopologySnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const buttonState = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
}));

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

vi.mock("~/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    readonly children: unknown;
    readonly disabled?: boolean;
    readonly onClick?: (event: never) => void;
  }) => {
    if (typeof children === "string" && onClick !== undefined) {
      buttonState.handlers.set(children, () => {
        onClick(undefined as never);
      });
    }
    return <button disabled={disabled}>{children as string}</button>;
  },
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

const AUTHORIZED: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "codex",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
    },
  ],
};

const LOGIN_IN_PROGRESS: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      ...AGENT_AUTH.agents[0]!,
      login: {
        phase: "menu",
        terminalId: "agent-login-codex",
        startedAt: DateTime.makeUnsafe("2026-08-30T12:00:00.000Z"),
      },
    },
  ],
};

const CANCELLED: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      ...AGENT_AUTH.agents[0]!,
      login: {
        phase: "cancelled",
        terminalId: "agent-login-codex",
        startedAt: DateTime.makeUnsafe("2026-08-30T12:00:00.000Z"),
      },
    },
  ],
};

beforeEach(() => {
  actions.cancel.mockReset();
  actions.signIn.mockReset();
  buttonState.handlers.clear();
});

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
  ])(
    "renders authorization exactly once inside the project panel: $name",
    ({ agentAuthCard, topology, rendersCard }) => {
      feedState.topology = topology;
      const html = renderToStaticMarkup(
        <ZeropsPanel agentAuthCard={agentAuthCard} threadRef={THREAD_REF} />,
      );

      expect(html.match(/data-zerops-agent-auth-card/gu) ?? []).toHaveLength(rendersCard ? 1 : 0);
      expect(html.includes("data-zerops-agent-auth-tray")).toBe(rendersCard);
      if (rendersCard) {
        expect(html.indexOf("data-zerops-project-panel")).toBeLessThan(
          html.indexOf("data-zerops-agent-auth-tray"),
        );
      }
    },
  );

  it.each([
    {
      name: "not authorized while topology is pending",
      snapshot: AGENT_AUTH,
      topology: undefined,
      label: "Sign in to Codex",
      expectedSignIn: true,
      expectedCancel: false,
    },
    {
      name: "login in progress while topology is degraded",
      snapshot: LOGIN_IN_PROGRESS,
      topology: { ...TOPOLOGY, degraded: true, reason: "last read failed" },
      label: "Cancel",
      expectedSignIn: false,
      expectedCancel: true,
    },
    {
      name: "authorized",
      snapshot: AUTHORIZED,
      topology: TOPOLOGY,
      label: null,
      expectedSignIn: false,
      expectedCancel: false,
    },
    {
      name: "cancelled login returns to sign in",
      snapshot: CANCELLED,
      topology: TOPOLOGY,
      label: "Sign in to Codex",
      expectedSignIn: true,
      expectedCancel: false,
    },
  ] as const)(
    "preserves not-authorized, login-in-progress, authorized and cancelled sign-in/cancel wiring: $name",
    ({ snapshot, topology, label, expectedSignIn, expectedCancel }) => {
      feedState.topology = topology;
      const html = renderToStaticMarkup(
        <ZeropsPanel agentAuthCard={snapshot} threadRef={THREAD_REF} />,
      );

      expect(html).toContain('data-zerops-primitive="flat-card"');
      if (label !== null) {
        buttonState.handlers.get(label)?.();
      }
      expect(actions.signIn).toHaveBeenCalledTimes(expectedSignIn ? 1 : 0);
      expect(actions.cancel).toHaveBeenCalledTimes(expectedCancel ? 1 : 0);
      if (expectedSignIn) {
        expect(actions.signIn).toHaveBeenCalledWith("codex");
      }
      if (expectedCancel) {
        expect(actions.cancel).toHaveBeenCalledWith("codex");
      }
    },
  );
});
