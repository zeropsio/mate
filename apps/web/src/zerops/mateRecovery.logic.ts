import type { ReachabilityAction } from "@t3tools/client-runtime/zerops/environments";

/**
 * Stage and retained conversation use the same verb for a container recovery press: it starts or
 * restarts the container, and says so — beside *Try now*, which only asks again, a restart called
 * *Try again* read as the same act (the owner, 2026-10-12).
 */
export function mateRecoveryActionLabel(action: "start" | "restart", busy = false): string {
  return busy ? "Asking Zerops…" : action === "start" ? "Start" : "Restart";
}

/**
 * What a Mate's link line offers: its voice's verbs, and *Restart* wherever HQ offers its Mate's
 * restart (`restart_mate`: it stopped answering while Zerops shows it running), which HQ runs
 * (`restartWay`); *Start* and *Restart* are pressable where the Mate's state offers them
 * (`mateState`), *Restart* also where HQ does.
 */
export function mateLinkVerbs(input: {
  readonly actions: ReadonlyArray<ReachabilityAction>;
  readonly verbs: { readonly start: boolean; readonly restart: boolean } | undefined;
  readonly restartOffered: boolean;
}): {
  readonly actions: ReadonlyArray<ReachabilityAction>;
  readonly start: boolean;
  readonly restart: boolean;
} {
  return {
    actions:
      input.restartOffered && !input.actions.includes("restart")
        ? [...input.actions, "restart"]
        : input.actions,
    start: input.verbs?.start === true,
    restart: input.verbs?.restart === true || input.restartOffered,
  };
}
