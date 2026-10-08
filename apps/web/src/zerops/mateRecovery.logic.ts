/** Stage and retained conversation use the same verb for a container recovery press. */
export function mateRecoveryActionLabel(action: "start" | "restart", busy = false): string {
  return busy ? "Asking Zerops…" : action === "start" ? "Start" : "Try again";
}
