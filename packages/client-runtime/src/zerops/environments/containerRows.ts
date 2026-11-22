/**
 * The container machines (DESIGN §4.5) in the rows' words: the health vocabulary the projects page
 * reads, and each machine's own level, which a Mate's state reads (`mateState`). Pure.
 */
import type { ZeropsContainerHealth } from "../containerHealth.ts";
import type { MateContainerLevel } from "../mateState.ts";
import { unansweredSinceUp, type ContainerMachine, type MateFlag } from "./containerMachine.ts";
import type { TargetKey } from "./exchange.ts";

export interface ContainerSnapshot {
  /** The row vocabulary of each target's container; absent until something was read. */
  readonly health: ReadonlyMap<TargetKey, ZeropsContainerHealth>;
  /** The server version each target's descriptor last reported. */
  readonly serverVersions: ReadonlyMap<TargetKey, string>;
  /** `ZCP_MATE_ENABLED` as read for a target no Mate answered on. */
  readonly mateFlags: ReadonlyMap<TargetKey, MateFlag>;
  /** Each target's container machine level, and whether its cap ran out. */
  readonly levels: ReadonlyMap<TargetKey, MateContainerLevel>;
}

/**
 * The container machine in the rows' words: `stalled` is a boot past its cap, a restart or an
 * update of ours is still coming up, a ready container no socket holds is unreachable once a probe
 * since it was last up went unanswered, and a verdict that needs an action predates Mate.
 */
export function containerHealthOf(machine: ContainerMachine): ZeropsContainerHealth | undefined {
  const reading = machine.reading?.reading.kind;
  switch (machine.state.level) {
    case "ready":
      return machine.connectedSince === null && unansweredSinceUp(machine)
        ? "unreachable"
        : "ready";
    case "booting":
      // A boot only failed probes suggest, its Mate not answering, is never a start running late.
      if (machine.state.guessed && (reading === "unreachable" || reading === "not-answering")) {
        return "unreachable";
      }
      if (machine.overdue) return "stalled";
      return reading === "unreachable" ? "unreachable" : "initializing";
    case "restarting":
    case "updating":
      return machine.overdue ? "stalled" : "initializing";
    case "needs-enable":
    case "needs-update":
    case "not-yet-available":
      return "predates-mate";
    case "unknown":
    case "creating":
    case "provisioning":
    case "inactive":
      return reading === "not-answering" ? "unreachable" : reading;
  }
}

export function containerSnapshotOf(
  machines: ReadonlyMap<TargetKey, ContainerMachine>,
): ContainerSnapshot {
  const health = new Map<TargetKey, ZeropsContainerHealth>();
  const serverVersions = new Map<TargetKey, string>();
  const mateFlags = new Map<TargetKey, MateFlag>();
  const levels = new Map<TargetKey, MateContainerLevel>();
  for (const [key, machine] of machines) {
    levels.set(key, { level: machine.state.level, overdue: machine.overdue });
    const verdict = containerHealthOf(machine);
    if (verdict !== undefined) health.set(key, verdict);
    const reading = machine.reading?.reading;
    if (reading?.kind === "ready") serverVersions.set(key, reading.descriptor.serverVersion);
    if (machine.mateFlag !== null) mateFlags.set(key, machine.mateFlag);
  }
  return { health, serverVersions, mateFlags, levels };
}
