import type { ZeropsChatChrome } from "./chatChrome";

export interface DefaultZeropsPanelInput {
  readonly topology: ZeropsChatChrome["panel"];
  readonly usesSheet: boolean;
  readonly handled: boolean;
  readonly hasPriorPanelChoice: boolean;
}

export type DefaultZeropsPanelDecision = "open" | "remember" | "wait";

/**
 * Decides whether the one-time desktop default may claim the right panel.
 * The store applies the decision atomically with its persisted handled marker.
 */
export function resolveDefaultZeropsPanel(
  input: DefaultZeropsPanelInput,
): DefaultZeropsPanelDecision {
  if (input.handled) {
    return "wait";
  }
  // The feed defines unavailable as a permanent fact for this environment.
  // Persist it so a later accidental transition cannot claim the panel.
  if (input.topology === "unavailable") return "remember";
  if (input.usesSheet || input.topology === "unknown") return "wait";
  return input.hasPriorPanelChoice ? "remember" : "open";
}
