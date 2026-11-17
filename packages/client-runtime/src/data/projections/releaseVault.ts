/**
 * What a release reads that production's vault lacks (D9: a release names what production's vault
 * lacks): production's variables as its vault holds them, with each service the release deploys
 * reading the run and build entries of the release's own zerops.yaml instead of the deployed one's.
 * A name none of it holds is a value to add before the release, where the reference resolves: a
 * plain `${KEY}` in production's Shared, a `${host_KEY}` on that runtime.
 *
 * Honest about what it does not know: `reading` until production's vault answered, and while a read
 * that failed is tried again (what it read whole before still stands); `unknown` only where it was
 * refused or cut short — an absence then proves nothing, and nothing is claimed missing. A
 * service production does not run yet (the release creates it) is not judged: what Zerops makes
 * on it is not known before it stands, and neither is a name of it.
 *
 * @module data/projections/releaseVault
 */
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { vaultWorldOf } from "./vault.ts";
import type { VaultScopeRef } from "./vaultModel.ts";
import { missingOf, type RefService, type RefWorld } from "./vaultReferences.ts";

/** One service the release deploys, with its entries in the release's zerops.yaml setup. */
export interface ReleasedSetup {
  readonly hostname: string;
  readonly run: ReadonlyArray<readonly [string, string]>;
  readonly build: ReadonlyArray<readonly [string, string]>;
}

export interface ReleaseVaultKey {
  readonly orgId: string;
  /** Production's Zerops project. */
  readonly projectId: string;
  readonly released: ReadonlyArray<ReleasedSetup>;
  /** The services the release creates in production, by hostname. */
  readonly creates: ReadonlyArray<string>;
}

/** A value the release reads that production's vault lacks. */
export interface ReleaseVaultGap {
  /** Its identity: where it would stand and its key. */
  readonly id: string;
  readonly key: string;
  /** The vault it is added to. */
  readonly scope: VaultScopeRef;
  /** That vault's service; `null` for Shared. */
  readonly holder: string | null;
  /** The services of the release that read it, by hostname. */
  readonly readers: ReadonlyArray<string>;
}

export type ReleaseVaultView =
  /**
   * Production's vault not answered yet, or tried again after a failure. `room`: the release's
   * entries name something only the vault can say, so a value step may come.
   */
  | { readonly state: "reading"; readonly room: boolean }
  | { readonly state: "unknown" }
  | { readonly state: "known"; readonly gaps: ReadonlyArray<ReleaseVaultGap> };

const UNKNOWN: ReleaseVaultView = { state: "unknown" };

/** A runtime of the release before production's vault is read: its entries, nothing else known. */
const standIn = (setup: ReleasedSetup): RefService => ({
  serviceId: `release\u0000${setup.hostname}`,
  hostname: setup.hostname,
  kind: "runtime",
  system: new Set(),
  entries: new Map(setup.run),
  own: new Map(),
});

/** Whether the release's entries name anything only production's vault can resolve. */
const needsVault = (released: ReadonlyArray<ReleasedSetup>): boolean => {
  const services = released.map(standIn);
  const world: RefWorld = { shared: new Map(), sharedSystem: new Set(), services };
  return released.some(
    (setup, at) => missingOf(world, services[at]!, new Map(setup.build)).length > 0,
  );
};

/** Zerops compares keys case-insensitively: one held in any case cannot be added again. */
const holds = (keys: Iterable<string>, key: string) => {
  const upper = key.toUpperCase();
  for (const held of keys) if (held.toUpperCase() === upper) return true;
  return false;
};

export const releaseVault: Projection<ReleaseVaultKey, ReleaseVaultView> = {
  name: "releaseVault",
  keyOf: (key) => JSON.stringify(key),
  derive: (read, { orgId, projectId, released, creates }) => {
    const { status, refused, whole, world } = vaultWorldOf(read, { orgId, projectId });
    if (refused) return UNKNOWN;
    // Tried again by itself: what was read whole still stands; otherwise it is still being read.
    if (status === "unread" || (status === "failed" && !whole))
      return { state: "reading", room: needsVault(released) };
    // Read, and cut short: an absence proves nothing.
    if (!whole) return UNKNOWN;
    const releasing = new Map(released.map((setup) => [setup.hostname, setup]));
    // What the release creates stands as a name of a service whose own values are Zerops'.
    const coming: ReadonlyArray<RefService> = creates
      .filter((hostname) => !world.services.some((service) => service.hostname === hostname))
      .map((hostname) => ({
        serviceId: `creates\u0000${hostname}`,
        hostname,
        kind: "other",
        system: new Set(),
        entries: new Map(),
        own: new Map(),
      }));
    const after: RefWorld = {
      ...world,
      services: [
        ...world.services.map((service) => {
          const setup = releasing.get(service.hostname);
          return setup === undefined || service.kind !== "runtime"
            ? service
            : { ...service, entries: new Map(setup.run) };
        }),
        ...coming,
      ],
    };
    const gaps = new Map<string, { gap: Omit<ReleaseVaultGap, "readers">; readers: Set<string> }>();
    for (const service of after.services) {
      const setup = releasing.get(service.hostname);
      if (setup === undefined || service.kind !== "runtime") continue;
      for (const missing of missingOf(after, service, new Map(setup.build))) {
        // A write Zerops would refuse is no step: a key held in another case, or one the
        // service's deployed zerops.yaml still sets (until the deploy that the step would hold).
        const deployed = world.services.find(
          (each) => each.serviceId === missing.holder?.serviceId,
        );
        if (
          missing.holder === null
            ? holds([...world.shared.keys(), ...world.sharedSystem], missing.key)
            : deployed === undefined ||
              holds(
                [...deployed.own.keys(), ...deployed.entries.keys(), ...deployed.system],
                missing.key,
              )
        )
          continue;
        const scope: VaultScopeRef =
          missing.holder === null
            ? { kind: "shared" }
            : { kind: "service", serviceId: missing.holder.serviceId };
        const id = `${scope.kind === "shared" ? "shared" : scope.serviceId}\u0000${missing.key}`;
        const held = gaps.get(id) ?? {
          gap: { id, key: missing.key, scope, holder: missing.holder?.hostname ?? null },
          readers: new Set<string>(),
        };
        held.readers.add(service.hostname);
        gaps.set(id, held);
      }
    }
    return {
      state: "known",
      gaps: [...gaps.values()]
        .map(({ gap, readers }) => ({ ...gap, readers: [...readers].sort() }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    };
  },
  equals: sameValue,
};
