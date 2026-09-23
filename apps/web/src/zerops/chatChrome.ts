/**
 * The Zerops decisions shared by the chat header, overlay, and right panel.
 *
 * This is a pure projection, never a feed subscriber or panel controller:
 * ChatView reads the feeds and the consumers keep their own rendering and
 * command wiring.
 */
import {
  zeropsAgentSignInRequired,
  type ZeropsAgentAuthView,
} from "@t3tools/client-runtime/zerops/agentLogin";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import type { ScopedThreadRef, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";

export interface ZeropsChatChrome {
  readonly threadRef: ScopedThreadRef | null;
  /**
   * `"unavailable"` is gone: that was `zcp studio topology`'s `available:
   * false`, a permanent fact only the container's own zcp binary could
   * state. `useProjectTopology` has no equivalent — a project ref that never
   * resolves and one still in flight look identical from here, and every
   * mate environment is a Zerops project by construction
   * (`docs/spec-mate.md` §9.3).
   */
  readonly panel: "available" | "unknown";
  /**
   * The agents' own home: visible whenever the feed itself is available
   * (this is a Zerops environment that has answered), whether or not any
   * agent currently needs attention — it is where agents are managed, not
   * only where a demand for one is raised.
   */
  readonly agentAuthCard: ZeropsAgentAuthSnapshot | null;
  /**
   * While the feed has no snapshot, what the card's place says instead of
   * showing no agents: that it is checking, or why the read failed.
   */
  readonly agentAuthUnknown: KnownMessage | null;
  /**
   * Whether the lifecycle band asks for a coding-agent sign-in. Narrower than
   * the card: one authorized agent is enough to work, so this is true only
   * when no agent is authorized (`docs/spec-mate.md` §5.4).
   */
  readonly agentSignInRequired: boolean;
  /**
   * The Zerops project's name, for the header and the draft headline. Read
   * from the topology whenever it has answered — a draft has an environment
   * before it has a thread, and "www" (the workspace folder) is not the
   * name of anything a person recognises.
   */
  readonly projectName: string | null;
}

export function resolveZeropsChatChrome(
  threadRef: ScopedThreadRef | null,
  input: {
    readonly topology: ZeropsTopologyView | undefined;
    readonly agentAuth: ZeropsAgentAuthView;
  },
): ZeropsChatChrome {
  const topologyProjectName = input.topology?.project.name.trim();
  const projectName = topologyProjectName ? topologyProjectName : null;

  if (threadRef === null) {
    return {
      threadRef: null,
      panel: "unknown",
      agentAuthCard: null,
      agentAuthUnknown: null,
      agentSignInRequired: false,
      projectName,
    };
  }

  const panel = input.topology === undefined ? "unknown" : "available";
  const agentAuth = input.agentAuth.snapshot;

  return {
    threadRef,
    panel,
    projectName,
    // The panel owns the snapshot even while closed. Chat chrome may expose an
    // in-flow entry to that panel, but never render the card over the timeline.
    agentAuthCard: agentAuth !== null && agentAuth.available ? agentAuth : null,
    agentAuthUnknown: input.agentAuth.unknown,
    agentSignInRequired: agentAuth !== null && zeropsAgentSignInRequired(agentAuth),
  };
}
