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
  if (input.handled || input.usesSheet || input.topology !== "available") {
    return "wait";
  }
  return input.hasPriorPanelChoice ? "remember" : "open";
}
