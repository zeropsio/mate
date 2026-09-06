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

const mateState = vi.hoisted(() => ({
  mates: new Map<
    string,
    { name: string; tint: string; project: string | undefined; connected: boolean }
  >(),
  faces: new Map<string, { face: string }>(),
}));

vi.mock("../../zerops/useZeropsMates", () => ({
  useZeropsMates: () => mateState.mates,
}));

vi.mock("../../zerops/useZeropsAgentActivity", () => ({
  useZeropsAgentActivity: () => mateState.faces,
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
  usageRead: false,
};

/** A project with its control plane — the container the Mate lives in. */
const VIEW_WITH_ZCP: ZeropsTopologyView = {
  ...VIEW,
  services: [
    {
      serviceId: "svc-zcp",
      hostname: "zcp",
      type: "ubuntu/zcp@1",
      status: "ACTIVE",
      group: "infrastructure",
      transient: false,
      routes: [],
      ports: [{ port: 8080, scheme: "http" }],
    },
  ],
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
  mateState.mates.clear();
  mateState.faces.clear();
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

describe("ZeropsPanel — the Mate's home", () => {
  it("hangs the agents card from the control-plane card when the project has one", () => {
    feedState.topology = resolved(VIEW_WITH_ZCP);
    const html = renderToStaticMarkup(
      <ZeropsPanel agentAuthCard={AGENT_AUTH} threadRef={THREAD_REF} />,
    );

    const rowAt = html.indexOf('data-zerops-service-row="control-plane"');
    expect(rowAt).toBeGreaterThan(0);
    const row = html.slice(rowAt, html.indexOf("</li>", rowAt));
    expect(row).toContain("data-zerops-agent-auth-tray");
    expect(row).toContain("data-zerops-agent-auth-card");
    expect(html.match(/data-zerops-agent-auth-card/gu)).toHaveLength(1);
    // No second heading: the card is part of the control plane's, not a section of its own.
    expect(html).not.toContain("Coding agents");
  });

  it("keeps the agents card on its own under a heading while there is no control plane to hang it from", () => {
    feedState.topology = resolved(VIEW);
    const html = renderToStaticMarkup(
      <ZeropsPanel agentAuthCard={AGENT_AUTH} threadRef={THREAD_REF} />,
    );

    expect(html).toContain("Coding agents");
    expect(html).toContain("data-zerops-agent-auth-tray");
    expect(html).not.toContain('data-zerops-service-row="control-plane"');
  });

  it("says who lives in the control plane, with the face the conversation wears", () => {
    feedState.topology = resolved(VIEW_WITH_ZCP);
    mateState.mates.set(THREAD_REF.environmentId, {
      name: "Fen",
      tint: "coral",
      project: "Acme",
      connected: true,
    });
    mateState.faces.set(THREAD_REF.environmentId, { face: "needs" });
    const html = renderToStaticMarkup(<ZeropsPanel agentAuthCard={null} threadRef={THREAD_REF} />);

    expect(html).toContain("data-zerops-mate-home");
    expect(html).toContain('data-mate-face-tint="coral"');
    expect(html).toContain('data-mate-face-state="needs"');
    expect(html).toContain(">Fen</span>");
  });

  it("wears the idle face until the conversation has an activity, and names nobody it does not know", () => {
    feedState.topology = resolved(VIEW_WITH_ZCP);
    mateState.mates.set(THREAD_REF.environmentId, {
      name: "Fen",
      tint: "sky",
      project: undefined,
      connected: true,
    });
    const idle = renderToStaticMarkup(<ZeropsPanel agentAuthCard={null} threadRef={THREAD_REF} />);
    expect(idle).toContain('data-mate-face-state="idle"');

    mateState.mates.clear();
    const nobody = renderToStaticMarkup(
      <ZeropsPanel agentAuthCard={null} threadRef={THREAD_REF} />,
    );
    expect(nobody).not.toContain("data-zerops-mate-home");
  });

  it("sleeps while the container is not connected, whatever the last activity said", () => {
    feedState.topology = resolved(VIEW_WITH_ZCP);
    // Known from the project's tags, or from the last reload's cache, before
    // this session's socket is up: the home says who, not that it is awake.
    mateState.mates.set(THREAD_REF.environmentId, {
      name: "Fen",
      tint: "coral",
      project: "Acme",
      connected: false,
    });
    mateState.faces.set(THREAD_REF.environmentId, { face: "working" });
    const html = renderToStaticMarkup(<ZeropsPanel agentAuthCard={null} threadRef={THREAD_REF} />);

    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).toContain(">Fen</span>");
  });
});
