/** Cached descriptors join environments to targets by ID; this projection never requests probes. */
import type { EnvironmentId } from "@t3tools/contracts";

import type { ContainerMachine } from "./containerMachine.ts";
import type { EnvironmentMachine } from "./environmentMachine.ts";
import type { TargetKey } from "./exchange.ts";
import { selectReachability, type Reachability } from "./reachability.ts";

export interface DescriptorIndex {
  /** Each environment a present target's descriptor reports, to that target. */
  readonly serving: ReadonlyMap<EnvironmentId, TargetKey>;
  /** Each present target whose descriptor answered as Mate, to the environment it reports. */
  readonly reported: ReadonlyMap<TargetKey, EnvironmentId>;
}

/** The Zerops project of a `projectId:serviceId` target. */
const projectOf = (key: TargetKey): string => key.split(":")[0] ?? key;

/** The descriptors already read by demanded targets. */
export function indexDescriptors(
  environments: ReadonlyMap<TargetKey, EnvironmentMachine>,
  containers: ReadonlyMap<TargetKey, ContainerMachine>,
): DescriptorIndex {
  const serving = new Map<EnvironmentId, TargetKey>();
  const reported = new Map<TargetKey, EnvironmentId>();
  for (const [key, machine] of environments) {
    if (machine.presence.kind !== "present") continue;
    const probed = containers.get(key)?.reading ?? null;
    if (probed === null) continue;
    const { reading } = probed;
    if (reading.kind === "ready") {
      if (reading.projectId !== projectOf(key)) continue;
      serving.set(reading.descriptor.environmentId, key);
      reported.set(key, reading.descriptor.environmentId);
      continue;
    }
  }
  return { serving, reported };
}

const holds = (machine: EnvironmentMachine, environmentId: EnvironmentId): boolean =>
  machine.credential.kind === "held" && machine.credential.environmentId === environmentId;

/**
 * The target whose machine names the environment: the one holding its credential, else one that
 * remembers it or knows the redeploy that replaced it.
 */
export function environmentTarget(
  machines: ReadonlyMap<TargetKey, EnvironmentMachine>,
  environmentId: EnvironmentId,
): { readonly key: TargetKey; readonly machine: EnvironmentMachine } | undefined {
  const entries = [...machines];
  const [key, machine] =
    entries.find(([, entry]) => holds(entry, environmentId)) ??
    entries.find(
      ([, entry]) => entry.record === environmentId || entry.superseded.has(environmentId),
    ) ??
    [];
  return key === undefined || machine === undefined ? undefined : { key, machine };
}

export interface ResolvedEnvironment {
  readonly key: TargetKey;
  readonly machine: EnvironmentMachine;
  /** §4.4's verdict for the environment on that target. */
  readonly reachability: Reachability;
}

/**
 * `resolveTarget` (§4.8): the target a machine names for the environment, else the one whose
 * descriptor serves it. Undefined while neither does.
 */
export function resolveEnvironment(
  machines: ReadonlyMap<TargetKey, EnvironmentMachine>,
  index: DescriptorIndex,
  environmentId: EnvironmentId,
): ResolvedEnvironment | undefined {
  const named = environmentTarget(machines, environmentId);
  const key = named?.key ?? index.serving.get(environmentId);
  const machine = named?.machine ?? (key === undefined ? undefined : machines.get(key));
  if (key === undefined || machine === undefined) return undefined;
  const verdict = selectReachability(machine, environmentId);
  const by = index.reported.get(key);
  // §4.4 row 2 off the descriptor: the target was found by its record, and its origin now reports
  // another environment. `gone` and a replacement the machine saw itself come first.
  const replaced =
    verdict.kind !== "gone" &&
    verdict.kind !== "replaced" &&
    by !== undefined &&
    by !== environmentId &&
    !holds(machine, environmentId);
  // Found only by its descriptor while the machine holds another environment's credential: the
  // machine's verdict is about that one, and its link's block re-reads the descriptor (§4.4).
  const heldForAnother = named === undefined && machine.credential.kind === "held";
  return {
    key,
    machine,
    reachability: replaced
      ? { kind: "replaced", by }
      : heldForAnother
        ? { kind: "connecting", waitingOn: "descriptor" }
        : verdict,
  };
}
