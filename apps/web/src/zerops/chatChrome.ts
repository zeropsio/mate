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

import type { RightPanelKind } from "../rightPanelStore";

export interface ZeropsChatChrome {
  readonly threadRef: ScopedThreadRef | null;
  readonly panel: "available" | "unavailable" | "unknown";
  readonly launcher: boolean;
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
      launcher: false,
      attention: null,
    };
  }

  // `available: false` is the feed's plain answer that there is no zcp here,
  // not an error. `panel` is the tri-state W3-F5c-PANEL's right-panel launcher
  // adapter reads; until that slice lands, its only reader is `launcher`.
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
    launcher: panel === "available",
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
