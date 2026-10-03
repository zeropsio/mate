/**
 * The Crew tab of a Mate nobody has signed in: the one "no agent yet" screen its conversation
 * shows (`ZeropsMateEmptyState`), word for word, in place of the crew's own screens.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const feed = vi.hoisted(() => ({
  agentAuth: undefined as unknown,
  providers: [] as ReadonlyArray<{ driver: string; enabled: boolean; status: string }>,
}));

vi.mock("~/zerops/useZeropsFeeds", () => ({
  useZeropsAgentAuth: () => feed.agentAuth,
  useEnvironmentProjectRef: () => null,
}));
vi.mock("~/zerops/useZeropsMates", () => ({
  useZeropsMate: () => ({
    kind: "mate",
    mate: {
      name: "Fen",
      tint: "olive",
      shape: "seal",
      project: "Acme Docs",
      projectUrl: "https://app.zerops.example/project/p1",
      connected: true,
    },
  }),
}));
vi.mock("~/zerops/crew/useCrew", () => ({
  hasCrewSurface: () => true,
  useCrew: () => ({ status: "none", snapshot: null, view: null, current: true }),
}));
vi.mock("~/zerops/crew/useCrewAccess", () => ({
  useCrewAccess: () => ({ login: () => null }),
}));
vi.mock("~/zerops/useAskMate", () => ({
  askMateThread: () => undefined,
  useAskMate: () => () => undefined,
}));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () => new Map([["env-fen", { cwd: "/var/www", providers: feed.providers }]]),
  useThreadShells: () => [],
}));
vi.mock("../ZeropsMateEmptyState", () => ({
  ZeropsMateEmptyState: ({ mate }: { readonly mate: { readonly name: string } }) => (
    <div data-no-agent-stage>{mate.name}</div>
  ),
}));
vi.mock("./CrewSectionHost", () => ({
  CrewSectionHost: () => <div data-crew-section-host />,
}));

import { CrewPanel } from "./CrewPanel";

const THREAD = scopeThreadRef(EnvironmentId.make("env-fen"), ThreadId.make("thread-main"));

const agents = (signedIn: boolean): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: signedIn,
      flagOAuth: signedIn,
      flagToken: false,
      providerAuth: signedIn ? "authenticated" : "unknown",
      state: signedIn ? "authorized" : "not-authorized",
    },
  ],
});

const known = (value: ZeropsAgentAuthSnapshot) => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});

beforeEach(() => {
  feed.agentAuth = undefined;
  feed.providers = [];
});

describe("CrewPanel — a Mate nobody has signed in", () => {
  it.each([
    { name: "no agent signed in", auth: known(agents(false)), stage: true },
    { name: "an agent signed in", auth: known(agents(true)), stage: false },
    { name: "its sign-in not read yet", auth: undefined, stage: false },
    // Mate signs people in to Claude Code and Codex only: a ready Cursor is an agent to run.
    {
      name: "no agent signed in, Cursor ready",
      auth: known(agents(false)),
      providers: [{ driver: "cursor", enabled: true, status: "ready" }],
      stage: false,
    },
  ])("$name: the no-agent stage $stage", ({ auth, providers, stage }) => {
    feed.agentAuth = auth;
    feed.providers = providers ?? [];
    const html = renderToStaticMarkup(<CrewPanel onSignIn={() => undefined} threadRef={THREAD} />);
    expect(html.includes("data-no-agent-stage")).toBe(stage);
  });
});
