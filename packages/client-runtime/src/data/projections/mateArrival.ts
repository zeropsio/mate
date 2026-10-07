import type { EnvironmentShellStatus } from "../../state/shell.ts";
import type { EnvironmentThreadStatus } from "../../state/threads.ts";

/** Existing snapshot/replay and auth coverage are inputs until their families migrate. */
export function mateArrival(input: {
  readonly connected: boolean;
  readonly shell: EnvironmentShellStatus;
  readonly hasConversation: boolean;
  readonly detail: EnvironmentThreadStatus;
  readonly detailHeld: boolean;
  readonly signInKnown: boolean;
  readonly cameUp: boolean;
}): "wait" | "conversation" | "create-conversation" {
  if (!input.connected) return "wait";
  if (!input.hasConversation) return input.shell === "live" ? "create-conversation" : "wait";
  return input.signInKnown && (input.detail === "live" || (!input.cameUp && input.detailHeld))
    ? "conversation"
    : "wait";
}
