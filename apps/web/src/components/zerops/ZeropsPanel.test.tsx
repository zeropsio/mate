import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const buttonState = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
}));

interface TopologySnapshot {
  readonly view: ZeropsTopologyView | undefined;
  readonly liveness: "live" | "polling" | undefined;
  readonly lastReadAt: number | undefined;
  readonly error: string | undefined;
}

const feedState = vi.hoisted(() => ({
  topology: {
    view: undefined,
    liveness: undefined,
    lastReadAt: undefined,
    error: undefined,
  } as TopologySnapshot,
}));

const actions = vi.hoisted(() => ({
  cancel: vi.fn(),
  signIn: vi.fn(),
  terminalSurface: null as string | null,
}));

vi.mock("../../zerops/useProjectTopology", () => ({
  useProjectTopology: () => feedState.topology,
}));

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsLifecycle: () => undefined,
  useZeropsAgentAuth: () => {
    throw new Error("ZeropsPanel must not consult the agent-auth feed");
  },
}));

vi.mock("../../zerops/useAgentLogin", () => ({
  useAgentLogin: (
    _threadRef: unknown,
    options?: { readonly terminalSurface?: "drawer" | "embedded" },
  ) => {
    actions.terminalSurface = options?.terminalSurface ?? null;
    return actions.signIn;
  },
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

const VIEW: ZeropsTopologyView = {
  project: { id: "proj-1", name: "z3-eval", status: "ACTIVE" },
  services: [],
  warnings: [],
};

const resolved = (
  view: ZeropsTopologyView | undefined,
  overrides: Partial<Omit<TopologySnapshot, "view">> = {},
): TopologySnapshot => ({
  view,
  liveness: "live",
  lastReadAt: 1_756_382_400_000,
  error: undefined,
  ...overrides,
});

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
  actions.terminalSurface = null;
  buttonState.handlers.clear();
  feedState.topology = {
    view: undefined,
    liveness: undefined,
    lastReadAt: undefined,
    error: undefined,
  };
});

/**
 * The client can no longer tell "still resolving which project this is"
 * apart from "never will" (that was `zcp studio topology`'s `available:
 * false`, a fact only the container's own zcp binary could state), so one
 * honest, non-committal message covers the whole absent-view case.
 */
describe("ZeropsPanelPlaceholder", () => {
  it("says it is reading the project", () => {
    const html = renderToStaticMarkup(<ZeropsPanelPlaceholder />);

    expect(html).toContain("Reading the project");
  });
});

describe("ZeropsPanel agent authorization ownership", () => {
  it("centers dense project content at a readable maximum width", () => {
    feedState.topology = resolved(VIEW);
    const html = renderToStaticMarkup(<ZeropsPanel agentAuthCard={null} threadRef={THREAD_REF} />);

    expect(html).toContain("mx-auto");
    expect(html).toContain("max-w-3xl");
  });

  it.each([
    {
      name: "no card when handed null even though the auth feed reports attention",
      agentAuthCard: null,
      view: VIEW,
      rendersCard: false,
    },
    {
      name: "a resolver-owned snapshot",
      agentAuthCard: AGENT_AUTH,
      view: VIEW,
      rendersCard: true,
    },
    {
      name: "a resolver-owned snapshot before topology answers",
      agentAuthCard: AGENT_AUTH,
      view: undefined,
      rendersCard: true,
    },
  ])(
    "renders authorization exactly once inside the project panel: $name",
    ({ agentAuthCard, view, rendersCard }) => {
      feedState.topology = view === undefined ? resolved(undefined) : resolved(view);
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
      topology: resolved(undefined),
      label: "Sign in to Codex",
      expectedSignIn: false,
      expectedCancel: false,
    },
    {
      name: "login in progress while the last read failed",
      snapshot: LOGIN_IN_PROGRESS,
      topology: resolved(VIEW, { error: "last read failed" }),
      label: "Cancel",
      expectedSignIn: false,
      expectedCancel: true,
    },
    {
      name: "authorized",
      snapshot: AUTHORIZED,
      topology: resolved(VIEW),
      label: null,
      expectedSignIn: false,
      expectedCancel: false,
    },
    {
      name: "cancelled login returns to sign in",
      snapshot: CANCELLED,
      topology: resolved(VIEW),
      label: "Sign in to Codex",
      expectedSignIn: false,
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
      expect(actions.terminalSurface).toBe("embedded");
      if (expectedSignIn) {
        expect(actions.signIn).toHaveBeenCalledWith("codex");
      }
      if (expectedCancel) {
        expect(actions.cancel).toHaveBeenCalledWith("codex");
      }
    },
  );
});
