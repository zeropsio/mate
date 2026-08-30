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

const topology = (available: boolean): ZeropsTopologySnapshot => ({
  available,
  degraded: false,
  services: [],
  warnings: [],
  readAt: DateTime.makeUnsafe("2026-08-30T12:00:00.000Z"),
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

const PANEL_KINDS = [
  { label: "with the panel closed", value: null, surface: "banner" },
  { label: "with the Zerops panel active", value: "zerops", surface: "panel" },
  { label: "with another panel active", value: "files", surface: "banner" },
] as const;

const CASES = THREADS.flatMap((thread) =>
  TOPOLOGIES.flatMap((topologyState) =>
    AUTH_STATES.flatMap((authState) =>
      PANEL_KINDS.map((panelKind) => ({
        name: `${thread.label}, ${topologyState.label}, ${authState.label}, ${panelKind.label}`,
        threadRef: thread.value,
        input: {
          topology: topologyState.value,
          agentAuth: authState.value,
          activeRightPanelKind: panelKind.value,
        },
        expected:
          thread.value === null
            ? {
                threadRef: null,
                panel: "unknown" as const,
                attention: null,
              }
            : {
                threadRef: thread.value,
                panel: topologyState.panel,
                attention: authState.needsAttention
                  ? { snapshot: ATTENTION, surface: panelKind.surface }
                  : null,
              },
      })),
    ),
  ),
);

describe("resolveZeropsChatChrome", () => {
  it.each(CASES)("$name", ({ threadRef, input, expected }) => {
    expect(resolveZeropsChatChrome(threadRef, input)).toEqual(expected);
  });
});
