/**
 * Stage and retained conversation use the same verb for a container recovery press: it starts or
 * restarts the container, and says so — beside *Try now*, which only asks again, a restart called
 * *Try again* read as the same act (the owner, 2026-10-12).
 */
export function mateRecoveryActionLabel(action: "start" | "restart", busy = false): string {
  return busy ? "Asking Zerops…" : action === "start" ? "Start" : "Restart";
}
