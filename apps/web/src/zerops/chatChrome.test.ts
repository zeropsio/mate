import {
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
  type ZeropsAgentAuthSnapshot,
  type ZeropsTopologySnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { resolveZeropsChatChrome } from "./chatChrome.ts";

const THREAD_REF: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const topology = (
  available: boolean,
  overrides: Partial<ZeropsTopologySnapshot> = {},
): ZeropsTopologySnapshot => ({
  available,
  degraded: false,
  services: [],
  warnings: [],
  readAt: DateTime.makeUnsafe("2026-08-30T12:00:00.000Z"),
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
  {
    label: "when Zerops is unavailable",
    value: topology(false),
    panel: "unavailable",
  },
  { label: "when Zerops is available", value: topology(true), panel: "available" },
] as const;

const AUTH_STATES = [
  { label: "before agent auth answers", value: undefined, needsAttention: false },
  { label: "when agent auth needs no attention", value: NO_ATTENTION, needsAttention: false },
  { label: "when agent auth needs attention", value: ATTENTION, needsAttention: true },
] as const;

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
              projectName: null,
            }
          : {
              threadRef: thread.value,
              panel: topologyState.panel,
              agentAuthCard: authState.needsAttention ? ATTENTION : null,
              projectName: null,
            },
    })),
  ),
);

describe("resolveZeropsChatChrome", () => {
  it.each(CASES)("keeps attention panel-owned: $name", ({ threadRef, input, expected }) => {
    expect(resolveZeropsChatChrome(threadRef, input)).toEqual(expected);
  });

  it("uses the trimmed Zerops project name only when topology is available", () => {
    expect(
      resolveZeropsChatChrome(THREAD_REF, {
        topology: topology(true, { project: { id: "project-1", name: "  zerops-xyz  " } }),
        agentAuth: NO_ATTENTION,
      }).projectName,
    ).toBe("zerops-xyz");

    expect(
      resolveZeropsChatChrome(THREAD_REF, {
        topology: topology(false, { project: { id: "project-1", name: "stale-name" } }),
        agentAuth: NO_ATTENTION,
      }).projectName,
    ).toBeNull();
  });
});
