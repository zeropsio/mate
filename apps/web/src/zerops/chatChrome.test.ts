import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import type { ZeropsAgentAuthView } from "@t3tools/client-runtime/zerops/agentLogin";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import { describe, expect, it } from "vite-plus/test";

import { resolveZeropsChatChrome } from "./chatChrome.ts";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const topology = (overrides: Partial<ZeropsTopologyView> = {}): ZeropsTopologyView => ({
  // Blank by default so the generic CASES table's "projectName: null" default
  // holds; only the dedicated project-name test below names a real project.
  project: { id: "project-1", name: "", status: "ACTIVE" },
  services: [],
  warnings: [],
  usageRead: false,
  ...overrides,
});

const NO_ATTENTION: ZeropsAgentAuthSnapshot = {
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

const ATTENTION: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

const THREADS = [
  { label: "without a thread", value: null },
  { label: "with a thread", value: THREAD_REF },
] as const;

const TOPOLOGIES = [
  { label: "before topology answers", value: undefined, panel: "unknown" },
  { label: "when Zerops is available", value: topology(), panel: "available" },
] as const;

const ONE_OF_TWO: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [...NO_ATTENTION.agents, ...ATTENTION.agents],
};

// The feed reports its own container as reachable but tells nothing about
// any agent (a Zerops environment `zcp studio` has not answered for yet).
const UNAVAILABLE: ZeropsAgentAuthSnapshot = { available: false, agents: [] };

const CHECKING: KnownMessage = {
  text: "Checking which coding agents are signed in…",
  afterMs: 400,
  tone: "quiet",
};

/** A known snapshot, as `zeropsAgentAuthView` reads it. */
const known = (snapshot: ZeropsAgentAuthSnapshot): ZeropsAgentAuthView => ({
  snapshot,
  unknown: null,
});

const AUTH_STATES: ReadonlyArray<{
  readonly label: string;
  readonly value: ZeropsAgentAuthView;
  readonly signInRequired: boolean;
}> = [
  // Not a Mate without agents: the agents' region says it is checking.
  {
    label: "before agent auth answers",
    value: { snapshot: null, unknown: CHECKING },
    signInRequired: false,
  },
  // The card used to disappear here (no agent needs attention); it is the
  // agents' own home, so it stays as long as the feed itself is available.
  {
    label: "when agent auth needs no attention",
    value: known(NO_ATTENTION),
    signInRequired: false,
  },
  {
    label: "when one agent is authorized and the other is not",
    value: known(ONE_OF_TWO),
    signInRequired: false,
  },
  { label: "when no agent is authorized", value: known(ATTENTION), signInRequired: true },
  {
    label: "when the feed itself is unavailable",
    value: known(UNAVAILABLE),
    signInRequired: false,
  },
];

const CASES = THREADS.flatMap((thread) =>
  TOPOLOGIES.flatMap((topologyState) =>
    AUTH_STATES.map((authState) => ({
      name: `${thread.label}, ${topologyState.label}, ${authState.label}`,
      threadRef: thread.value,
      input: {
        topology: topologyState.value,
        agentAuth: authState.value,
      },
      expected:
        thread.value === null
          ? {
              threadRef: null,
              panel: "unknown" as const,
              agentAuthCard: null,
              agentAuthUnknown: null,
              agentSignInRequired: false,
              projectName: null,
            }
          : {
              threadRef: thread.value,
              panel: topologyState.panel,
              agentAuthCard:
                authState.value.snapshot !== null && authState.value.snapshot.available
                  ? authState.value.snapshot
                  : null,
              agentAuthUnknown: authState.value.unknown,
              agentSignInRequired: authState.signInRequired,
              projectName: null,
            },
    })),
  ),
);

describe("resolveZeropsChatChrome", () => {
  it.each(CASES)("keeps attention panel-owned: $name", ({ threadRef, input, expected }) => {
    expect(resolveZeropsChatChrome(threadRef, input)).toEqual(expected);
  });

  it("names the project for a draft too: the environment is known before the thread is", () => {
    expect(
      resolveZeropsChatChrome(null, {
        topology: topology({ project: { id: "project-1", name: "acme-docs-dev" } }),
        agentAuth: { snapshot: null, unknown: null },
      }),
    ).toEqual({
      threadRef: null,
      panel: "unknown",
      agentAuthCard: null,
      agentAuthUnknown: null,
      agentSignInRequired: false,
      projectName: "acme-docs-dev",
    });
  });

  it("uses the trimmed Zerops project name only when topology is available", () => {
    expect(
      resolveZeropsChatChrome(THREAD_REF, {
        topology: topology({ project: { id: "project-1", name: "  zerops-xyz  " } }),
        agentAuth: known(NO_ATTENTION),
      }).projectName,
    ).toBe("zerops-xyz");

    expect(
      resolveZeropsChatChrome(THREAD_REF, {
        topology: undefined,
        agentAuth: known(NO_ATTENTION),
      }).projectName,
    ).toBeNull();
  });
});
