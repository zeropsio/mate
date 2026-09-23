/**
 * The descriptor index (DESIGN §4.8 `resolveTarget`, §2.C C6): which Mate target an environment
 * id belongs to, read off the descriptors the probe store last read at every present target's
 * origin. A pure projection over the exchange driver's machines and the container store's.
 *
 * - A target's machine names an environment first: the credential it holds, then its record or
 *   the redeploys it saw. The index answers for an environment no machine names — a deep link on
 *   a device with no record.
 * - A remembered environment whose target's descriptor now reports another was replaced by it:
 *   a redeploy that dropped the Mate's data history. A credential held for it is left to its link,
 *   whose block re-reads the descriptor (§4.4), so a reading older than the credential never
 *   ends a live route. Nothing is retired for it: drafts keep their keys (AL-13).
 * - A descriptor serves an environment only for the target whose project it states
 *   (`zerops.projectId`): an origin answering for another project's Mate, or for no project, has
 *   answered and serves nothing here.
 * - A present target's descriptor has answered once its origin was read as Mate (`ready`) or as
 *   serving no Mate at all (`predates-mate`). Unread, still coming up or unreachable, it has not,
 *   and an environment nothing names stays undecided until it has: "not in your projects" is
 *   earned only when every present target answered with another environment.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { ContainerMachine } from "./containerMachine.ts";
import type { EnvironmentMachine } from "./environmentMachine.ts";
import type { TargetKey } from "./exchangeDriver.ts";
import { selectReachability, type Reachability } from "./reachability.ts";

export interface DescriptorIndex {
  /** Each environment a present target's descriptor reports, to that target. */
  readonly serving: ReadonlyMap<EnvironmentId, TargetKey>;
  /** Each present target whose descriptor answered as Mate, to the environment it reports. */
  readonly reported: ReadonlyMap<TargetKey, EnvironmentId>;
  /** Present targets whose descriptor has not answered: unread, coming up, or unreachable. */
  readonly unanswered: ReadonlyArray<TargetKey>;
  /**
   * The unanswered targets already read once, coming up or unreachable: the ones a sweep reads
   * again. An unread one is on its way — the container store reads every target it lists.
   */
  readonly failed: ReadonlyArray<TargetKey>;
}

/** The Zerops project of a `projectId:serviceId` target. */
const projectOf = (key: TargetKey): string => key.split(":")[0] ?? key;

/** Every present target's descriptor as the container store last read it. */
export function indexDescriptors(
  environments: ReadonlyMap<TargetKey, EnvironmentMachine>,
  containers: ReadonlyMap<TargetKey, ContainerMachine>,
): DescriptorIndex {
  const serving = new Map<EnvironmentId, TargetKey>();
  const reported = new Map<TargetKey, EnvironmentId>();
  const unanswered: Array<TargetKey> = [];
  const failed: Array<TargetKey> = [];
  for (const [key, machine] of environments) {
    if (machine.presence.kind !== "present") continue;
    const reading = containers.get(key)?.reading?.reading;
    if (reading?.kind === "ready") {
      if (reading.projectId !== projectOf(key)) continue;
      serving.set(reading.descriptor.environmentId, key);
      reported.set(key, reading.descriptor.environmentId);
      continue;
    }
    if (reading?.kind === "predates-mate") continue;
    unanswered.push(key);
    if (reading !== undefined) failed.push(key);
  }
  return { serving, reported, unanswered, failed };
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
  return {
    key,
    machine,
    reachability: replaced ? { kind: "replaced", by } : verdict,
  };
}
