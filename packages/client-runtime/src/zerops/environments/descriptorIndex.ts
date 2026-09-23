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
 * - An environment a target's descriptor reports while its machine still holds another's
 *   credential waits on the descriptor: the machine's verdict speaks for the environment it holds.
 * - A descriptor serves an environment only for the target whose project it states
 *   (`zerops.projectId`): an origin answering for another project's Mate, or for no project, has
 *   answered and serves nothing here.
 * - A present target's descriptor has answered once its origin was read as Mate (`ready`), as
 *   serving no Mate at all (`predates-mate`), or as failed: unreachable — a network or CORS
 *   failure, or the L7's answer while the container boots — on the sweep's read as well as on the
 *   one before it. A failed read names no environment, and the sweep reads it again: on the
 *   target's own poll, so the two failures lie at least a poll interval apart (`sweepRead`); at
 *   once only for a target no poll reads. A Mate that answers `/healthz` and not its descriptor
 *   (`initializing`) never answers the sweep: it is there, and its descriptor is on its way. An
 *   environment nothing names stays undecided while any present target has not answered: "not in
 *   your projects" is earned once every present target answered with another environment or
 *   failed.
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { Instant } from "../data/access/grant.ts";
import { probeCadence, type ContainerMachine } from "./containerMachine.ts";
import type { EnvironmentMachine } from "./environmentMachine.ts";
import type { TargetKey } from "./exchangeDriver.ts";
import { POLL_INTERVAL_MS } from "./probeStore.ts";
import { selectReachability, type Reachability } from "./reachability.ts";

export interface DescriptorIndex {
  /** Each environment a present target's descriptor reports, to that target. */
  readonly serving: ReadonlyMap<EnvironmentId, TargetKey>;
  /** Each present target whose descriptor answered as Mate, to the environment it reports. */
  readonly reported: ReadonlyMap<TargetKey, EnvironmentId>;
  /**
   * Present targets whose descriptor has not answered: unread — the container store reads every
   * target it lists —, initializing, or unreachable on a read that left before the sweep's.
   */
  readonly unanswered: ReadonlyArray<TargetKey>;
  /** Present targets whose last read failed, coming up or unreachable: the ones a sweep reads again. */
  readonly failed: ReadonlyArray<TargetKey>;
}

/** The Zerops project of a `projectId:serviceId` target. */
const projectOf = (key: TargetKey): string => key.split(":")[0] ?? key;

const sentSince = (sentAt: Instant, since: Instant): boolean =>
  sentAt.wall >= since.wall && sentAt.mono >= since.mono;

/** How the sweep reads a failed target again: the earliest read that counts, and whether to ask. */
export interface SweepRead {
  /** A failed read sent from this instant on is the sweep's. */
  readonly from: Instant;
  /** Ask the probe store now: nothing else reads this target again. */
  readonly request: boolean;
}

/**
 * The sweep's read of a target whose last read failed (§4.8), asked at `asked`. A target its
 * container polls is read on that poll's ladder, never sooner than a poll interval after the
 * failure the sweep saw: a Mate that fails fast while it boots is not answered by reads sent a
 * moment apart. A target nothing polls — its link is up — is read once more now.
 */
export function sweepRead(container: ContainerMachine | undefined, asked: Instant): SweepRead {
  const failedAt = container?.reading?.sentAt;
  if (
    container === undefined ||
    failedAt === undefined ||
    probeCadence(container).kind !== "poll"
  ) {
    return { from: asked, request: true };
  }
  return {
    from: { wall: failedAt.wall + POLL_INTERVAL_MS, mono: failedAt.mono + POLL_INTERVAL_MS },
    request: false,
  };
}

/**
 * Every present target's descriptor as the container store last read it; `reread` holds, for each
 * target the sweep reads again, the instant its read counts from (`sweepRead`).
 */
export function indexDescriptors(
  environments: ReadonlyMap<TargetKey, EnvironmentMachine>,
  containers: ReadonlyMap<TargetKey, ContainerMachine>,
  reread: ReadonlyMap<TargetKey, Instant>,
): DescriptorIndex {
  const serving = new Map<EnvironmentId, TargetKey>();
  const reported = new Map<TargetKey, EnvironmentId>();
  const unanswered: Array<TargetKey> = [];
  const failed: Array<TargetKey> = [];
  for (const [key, machine] of environments) {
    if (machine.presence.kind !== "present") continue;
    const probed = containers.get(key)?.reading ?? null;
    if (probed === null) {
      unanswered.push(key);
      continue;
    }
    const { reading, sentAt } = probed;
    if (reading.kind === "ready") {
      if (reading.projectId !== projectOf(key)) continue;
      serving.set(reading.descriptor.environmentId, key);
      reported.set(key, reading.descriptor.environmentId);
      continue;
    }
    if (reading.kind === "predates-mate") continue;
    failed.push(key);
    const rereadAt = reread.get(key);
    // Unreachable on the sweep's read as well as on the one before it: failed, and answered.
    if (reading.kind === "unreachable" && rereadAt !== undefined && sentSince(sentAt, rereadAt)) {
      continue;
    }
    unanswered.push(key);
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
