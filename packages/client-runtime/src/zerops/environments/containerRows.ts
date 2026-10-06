/**
 * The container machines (DESIGN §4.5) in the rows' words: the health vocabulary the sidebar and
 * the projects page read. Pure.
 */
import type { ZeropsContainerHealth } from "../containerHealth.ts";
import { unansweredSinceUp, type ContainerMachine, type MateFlag } from "./containerMachine.ts";
import type { TargetKey } from "./exchange.ts";

export interface ContainerSnapshot {
  /** The row vocabulary of each target's container; absent until something was read. */
  readonly health: ReadonlyMap<TargetKey, ZeropsContainerHealth>;
  /** The server version each target's descriptor last reported. */
  readonly serverVersions: ReadonlyMap<TargetKey, string>;
  /** `ZCP_MATE_ENABLED` as read for a target that predates Mate. */
  readonly mateFlags: ReadonlyMap<TargetKey, MateFlag>;
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
  for (const [key, machine] of machines) {
    const verdict = containerHealthOf(machine);
    if (verdict !== undefined) health.set(key, verdict);
    const reading = machine.reading?.reading;
    if (reading?.kind === "ready") serverVersions.set(key, reading.descriptor.serverVersion);
    if (machine.mateFlag !== null) mateFlags.set(key, machine.mateFlag);
  }
  return { health, serverVersions, mateFlags };
}
