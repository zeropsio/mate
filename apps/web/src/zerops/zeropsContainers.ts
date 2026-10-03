/**
 * The account's container store (DESIGN §4.5), as the account runtime's post-grant stage holds it:
 * every Mate container's level, every probe of one, and our own restarts and updates. Surfaces
 * read it through `useZeropsContainers`, and verbs tell it what they started through
 * `intendContainer`.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  containerSnapshotOf,
  containerVerdict,
  environmentTarget,
  targetProject,
  type ContainerMachine,
  type ContainerSnapshot,
  type ContainerVerdict,
  type IntentRequest,
  type ProbeReading,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { useMemo } from "react";

import { hqMatesAtom } from "~/state/zerops";
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

/**
 * The container's `/healthz` `initAt`, read just before a restart verb is sent: its intent carries
 * it, so the restart is over when that value moves. Null when nothing could say.
 */
export async function readContainerInitAt(key: TargetKey): Promise<string | null> {
  return (await currentAccountEnvironments()?.initAt(key)) ?? null;
}

/** The reading of a probe of this origin started from now on, through the account's one pool. */
export async function nextContainerReading(origin: string): Promise<ProbeReading> {
  return (await accountEnvironmentsReady()).next(origin);
}

export interface TargetContainer {
  readonly key: TargetKey | null;
  readonly verdict: ContainerVerdict;
  /** The server version its Mate runs (`serverVersionOf`); undefined while nothing says. */
  readonly serverVersion: string | undefined;
}

const UNKNOWN: ContainerVerdict = { level: "unknown" };

/**
 * The server version a target's Mate runs, by the newer of two facts: HQ's overview identity, true
 * from when its presence last moved, and the last read that found it answering, true when it was
 * sent. A Mate HQ holds online is never read, so HQ's word stands for it; a read sent since — the
 * route's Mate, a restart of ours coming back before HQ hears it — outranks a word not updated yet.
 */
export function serverVersionOf(
  machine: ContainerMachine | undefined,
  mate: MateLiveView | undefined,
): string | undefined {
  const probed = machine?.reading;
  const read =
    probed?.reading.kind === "ready"
      ? { version: probed.reading.descriptor.serverVersion, sentAt: probed.sentAt.wall }
      : null;
  if (mate?.identity === undefined) return read?.version;
  return read !== null && read.sentAt > Date.parse(mate.presence.since)
    ? read.version
    : mate.identity.serverVersion;
}

/** Every Mate container in the rows' words, each server version as `serverVersionOf` reads it. */
export function containerSnapshotWithHq(
  machines: ReadonlyMap<TargetKey, ContainerMachine>,
  mates: HqMates | null | undefined,
): ContainerSnapshot {
  const serverVersions = new Map<TargetKey, string>();
  for (const [key, machine] of machines) {
    const version = serverVersionOf(machine, mates?.get(targetProject(key)));
    if (version !== undefined) serverVersions.set(key, version);
  }
  return { ...containerSnapshotOf(machines), serverVersions };
}

/** One target's container as the container store holds it now. */
export function useTargetContainer(key: TargetKey | null): TargetContainer {
  const machines = useContainerMachines();
  const mates = useAtomValue(hqMatesAtom)?.mates;
  const machine = key === null ? undefined : machines.get(key);
  const mate = key === null ? undefined : mates?.get(targetProject(key));
  return useMemo(
    () => ({
      key,
      verdict: machine === undefined ? UNKNOWN : containerVerdict(machine),
      serverVersion: serverVersionOf(machine, mate),
    }),
    [key, machine, mate],
  );
}

/** The container of the target that holds or remembers this environment (§4.4). */
export function useEnvironmentContainer(environmentId: EnvironmentId): TargetContainer {
  const environments = useEnvironmentMachines();
  return useTargetContainer(environmentTarget(environments, environmentId)?.key ?? null);
}

/** Every Mate container of the account, as the container store holds it now. */
export function useZeropsContainers(): ContainerSnapshot {
  const machines = useContainerMachines();
  const mates = useAtomValue(hqMatesAtom)?.mates;
  return useMemo(() => containerSnapshotWithHq(machines, mates), [machines, mates]);
}
