/**
 * The account's container store (DESIGN §4.5), as the account runtime's post-grant stage holds it:
 * every Mate container's level, every probe of one, and our own restarts and updates. Surfaces
 * read it through `useZeropsContainers`, and verbs tell it what they started through
 * `intendContainer`.
 */
import {
  containerSnapshotOf,
  containerVerdict,
  environmentTarget,
  type ContainerSnapshot,
  type ContainerVerdict,
  type IntentRequest,
  type ProbeReading,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import {
  accountEnvironmentsReady,
  currentAccountEnvironments,
  useContainerMachines,
  useEnvironmentMachines,
} from "./accountEnvironments";

/**
 * Our verb was accepted for this target: its container shows it until a read fact settles it.
 * False when no container took it — no account stage stands, the store holds no such target, or
 * the platform's facts already overrule it — so nothing will say when it is over.
 */
export function intendContainer(key: TargetKey, intent: IntentRequest): boolean {
  return currentAccountEnvironments()?.intend(key, intent) ?? false;
}

/** The reading of a probe of this origin started from now on, through the account's one pool. */
export async function nextContainerReading(origin: string): Promise<ProbeReading> {
  return (await accountEnvironmentsReady()).next(origin);
}

export interface TargetContainer {
  readonly key: TargetKey | null;
  readonly verdict: ContainerVerdict;
  /** The server version its descriptor last reported; undefined before one answered. */
  readonly serverVersion: string | undefined;
}

const UNKNOWN: ContainerVerdict = { level: "unknown" };

/** One target's container as the container store holds it now. */
export function useTargetContainer(key: TargetKey | null): TargetContainer {
  const machines = useContainerMachines();
  const machine = key === null ? undefined : machines.get(key);
  return useMemo(() => {
    const reading = machine?.reading?.reading;
    return {
      key,
      verdict: machine === undefined ? UNKNOWN : containerVerdict(machine),
      serverVersion: reading?.kind === "ready" ? reading.descriptor.serverVersion : undefined,
    };
  }, [key, machine]);
}

/** The container of the target that holds or remembers this environment (§4.4). */
export function useEnvironmentContainer(environmentId: EnvironmentId): TargetContainer {
  const environments = useEnvironmentMachines();
  return useTargetContainer(environmentTarget(environments, environmentId)?.key ?? null);
}

/** Every Mate container of the account, as the container store holds it now. */
export function useZeropsContainers(): ContainerSnapshot {
  const machines = useContainerMachines();
  return useMemo(() => containerSnapshotOf(machines), [machines]);
}
