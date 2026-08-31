/**
 * The Zerops decisions shared by the chat header, overlay, and right panel.
 *
 * This is a pure projection, never a feed subscriber or panel controller:
 * ChatView reads the snapshots and the consumers keep their own rendering and
 * command wiring.
 */
import { zeropsAgentAuthNeedsAttention } from "@t3tools/client-runtime/zerops/agentLogin";
import type {
  ScopedThreadRef,
  ZeropsAgentAuthSnapshot,
  ZeropsTopologySnapshot,
} from "@t3tools/contracts";

export interface ZeropsChatChrome {
  readonly threadRef: ScopedThreadRef | null;
  readonly panel: "available" | "unavailable" | "unknown";
  readonly agentAuthCard: ZeropsAgentAuthSnapshot | null;
}

export function resolveZeropsChatChrome(
  threadRef: ScopedThreadRef | null,
  input: {
    readonly topology: ZeropsTopologySnapshot | undefined;
    readonly agentAuth: ZeropsAgentAuthSnapshot | undefined;
  },
): ZeropsChatChrome {
  if (threadRef === null) {
    return {
      threadRef: null,
      panel: "unknown",
      agentAuthCard: null,
    };
  }

  // `available: false` is the feed's plain answer that there is no zcp here,
  // not an error. The right-panel launcher adapter reads this tri-state.
  const panel =
    input.topology === undefined
      ? "unknown"
      : input.topology.available
        ? "available"
        : "unavailable";
  const agentAuth = input.agentAuth;

  return {
    threadRef,
    panel,
    // The panel owns the snapshot even while closed. Chat chrome may expose an
    // in-flow entry to that panel, but never render the card over the timeline.
    agentAuthCard:
      agentAuth !== undefined && zeropsAgentAuthNeedsAttention(agentAuth) ? agentAuth : null,
  };
}
