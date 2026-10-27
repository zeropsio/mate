import type { RelayAgentAwarenessPhase } from "@t3tools/contracts/relay";
import { kindForAwarenessPhase, type ThreadStatusKind } from "@t3tools/shared/threadStatus";

export function statusLabel(kind: Exclude<ThreadStatusKind, "idle">): string;
export function statusLabel(kind: "idle"): null;
export function statusLabel(kind: ThreadStatusKind): string | null;
export function statusLabel(kind: ThreadStatusKind): string | null {
  switch (kind) {
    case "approval":
      return "Approval";
    case "input":
      return "Input";
    case "failed":
      return "Failed";
    case "connecting":
      return "Connecting";
    case "working":
      return "Working";
    case "planReady":
      return "Plan Ready";
    case "monitoring":
      return "Monitoring";
    case "done":
      return "Done";
    case "woke":
      return "Woke";
    case "idle":
      return null;
  }
}

export function statusPulses(kind: ThreadStatusKind): boolean {
  return kind === "connecting" || kind === "working";
}

export function awarenessPhaseStatusLabel(phase: RelayAgentAwarenessPhase): string {
  // Stale is an edge-only wire phase rather than a thread status kind. Its
  // waiting copy stays here so every consumer still reads one phrase producer.
  if (phase === "stale") return "Waiting";

  return statusLabel(kindForAwarenessPhase(phase));
}
