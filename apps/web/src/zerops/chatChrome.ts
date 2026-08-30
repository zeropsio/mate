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

import type { RightPanelKind } from "../rightPanelKinds";

export interface ZeropsChatChrome {
  readonly threadRef: ScopedThreadRef | null;
  readonly panel: "available" | "unavailable" | "unknown";
  readonly attention: {
    readonly snapshot: ZeropsAgentAuthSnapshot;
    readonly surface: "banner" | "panel";
  } | null;
}

export function resolveZeropsChatChrome(
  threadRef: ScopedThreadRef | null,
  input: {
    readonly topology: ZeropsTopologySnapshot | undefined;
    readonly agentAuth: ZeropsAgentAuthSnapshot | undefined;
    readonly activeRightPanelKind: RightPanelKind | null;
  },
): ZeropsChatChrome {
  if (threadRef === null) {
    return {
      threadRef: null,
      panel: "unknown",
      attention: null,
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
    // S7-D4 keeps provider-auth guidance beside ProviderStatusBanner unless
    // the open panel owns it, so the snapshot and its destination stay bound.
    attention:
      agentAuth !== undefined && zeropsAgentAuthNeedsAttention(agentAuth)
        ? {
            snapshot: agentAuth,
            surface: input.activeRightPanelKind === "zerops" ? "panel" : "banner",
          }
        : null,
  };
}
