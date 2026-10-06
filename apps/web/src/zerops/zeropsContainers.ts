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
  type ContainerSnapshot,
  type ContainerVerdict,
  type IntentRequest,
  type ProbeReading,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { MateLinkValue } from "@t3tools/client-runtime/data";
import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { useMemo } from "react";

import { hqMatesAtom } from "~/state/zerops";
import {
  accountEnvironmentsReady,
  currentAccountEnvironments,
  useEnvironmentMachines,
  useMateLinkValues,
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

/** A Mate as the account's store holds it: its container, and whether it is read itself now. */
export type MateReading = Pick<MateLinkValue, "container" | "watched">;

/**
 * The server version a target's Mate runs: its own answer while something reads it — the route's
 * Mate, a restart of ours coming back before HQ hears it — else HQ's overview identity, else the
 * last answer it gave here. No clock decides between them.
 */
export function serverVersionOf(
  link: MateReading | undefined,
  mate: MateLiveView | undefined,
): string | undefined {
  const probed = link?.container.reading?.reading;
  const own = probed?.kind === "ready" ? probed.descriptor.serverVersion : undefined;
  if (link?.watched === true && own !== undefined) return own;
  return mate?.identity?.serverVersion ?? own;
}

/** Every Mate container in the rows' words, each server version as `serverVersionOf` reads it. */
export function containerSnapshotWithHq(
  links: ReadonlyMap<TargetKey, MateReading>,
  mates: HqMates | null | undefined,
): ContainerSnapshot {
  const serverVersions = new Map<TargetKey, string>();
  for (const [key, link] of links) {
    const version = serverVersionOf(link, mates?.get(targetProject(key)));
    if (version !== undefined) serverVersions.set(key, version);
  }
  const machines = new Map([...links].map(([key, link]) => [key, link.container] as const));
  return { ...containerSnapshotOf(machines), serverVersions };
}

/** One target's container as the account's store holds it now. */
export function useTargetContainer(key: TargetKey | null): TargetContainer {
  const links = useMateLinkValues();
  const mates = useAtomValue(hqMatesAtom)?.mates;
  const link = key === null ? undefined : links.get(key);
  const mate = key === null ? undefined : mates?.get(targetProject(key));
  return useMemo(
    () => ({
      key,
      verdict: link === undefined ? UNKNOWN : containerVerdict(link.container),
      serverVersion: serverVersionOf(link, mate),
    }),
    [key, link, mate],
  );
}

/** The container of the target that holds or remembers this environment (§4.4). */
export function useEnvironmentContainer(environmentId: EnvironmentId): TargetContainer {
  const environments = useEnvironmentMachines();
  return useTargetContainer(environmentTarget(environments, environmentId)?.key ?? null);
}

/** Every Mate container of the account, as the account's store holds it now. */
export function useZeropsContainers(): ContainerSnapshot {
  const links = useMateLinkValues();
  const mates = useAtomValue(hqMatesAtom)?.mates;
  return useMemo(() => containerSnapshotWithHq(links, mates), [links, mates]);
}
