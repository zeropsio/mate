/**
 * Where a `${name}` in a deployed zerops.yml run entry resolves, and so which services read each
 * vault value: pure, over one project's variables as the vault holds them.
 *
 * The platform's precedence inside one service, measured 2026-10-07: what it made (`hostname`,
 * `PATH`…) > the service's zerops.yml entries > the service's own values > Shared (and what Zerops
 * made there). `${host_KEY}` is another service's variable: a name is split at its first `_` only
 * where the part before it is a hostname in the project (hostnames are lowercase letters and
 * digits). `KEY: ${KEY}` reaches the app as the literal text `${KEY}`, and so does every other
 * entry of that service naming `KEY`; a name nothing has stays literal. Renames and chains resolve:
 * through entries, and through plain values that hold references themselves.
 *
 * @module data/projections/vaultReferences
 */
import type { VaultReader, VaultRef, VaultScopeRef } from "./vaultModel.ts";

/** One service of the project as references see it. */
export interface RefService {
  readonly serviceId: string;
  readonly hostname: string;
  /**
   * `runtime` runs the person's code and reads; `managed` (a database) holds values Zerops made;
   * `other` (the Mate's zcp, a build container) holds no vault: what it has is the platform's.
   */
  readonly kind: "runtime" | "managed" | "other";
  /** The names Zerops made on it that are not vault values (`hostname`, `PATH`, `projectId`…). */
  readonly system: ReadonlySet<string>;
  /** Its deployed zerops.yml run entries: key → template. */
  readonly entries: ReadonlyMap<string, string>;
  /** Its vault values: key → the plain value, `null` for a sensitive one. */
  readonly own: ReadonlyMap<string, string | null>;
}

/** One project's variables as references see them. */
export interface RefWorld {
  /** Shared's values: key → the plain value, `null` for a sensitive one. */
  readonly shared: ReadonlyMap<string, string | null>;
  /** The names Zerops made in Shared (`zeropsSubdomainHost`…). */
  readonly sharedSystem: ReadonlySet<string>;
  readonly services: ReadonlyArray<RefService>;
}

/** How deep a chain of entries and values is followed. */
const MAX_DEPTH = 8;

const REFERENCE = /\$\{([A-Za-z0-9_]+)\}/g;

/** The names a template references, in order. */
export const parseRefs = (template: string): ReadonlyArray<string> =>
  [...template.matchAll(REFERENCE)].map((match) => match[1]!);

/** A vault value's identity across scopes. */
export const valueIdOf = (scope: VaultScopeRef, key: string): string =>
  `${scope.kind === "shared" ? "shared" : scope.serviceId}\u0000${key}`;

const scopeOf = (service: RefService): VaultScopeRef => ({
  kind: "service",
  serviceId: service.serviceId,
});

type Target =
  | { readonly kind: "entry"; readonly key: string; readonly template: string }
  | {
      readonly kind: "value";
      readonly scope: VaultScopeRef;
      readonly key: string;
      readonly value: string | null;
      /** Where its own references resolve. */
      readonly context: RefService;
    }
  | { readonly kind: "platform" }
  | { readonly kind: "missing" };

const PLATFORM: Target = { kind: "platform" };
const MISSING: Target = { kind: "missing" };

/** What `${host_key}` names in another service, the name split after a hostname. */
function elsewhere(world: RefWorld, name: string): Target | null {
  const at = name.indexOf("_");
  if (at <= 0) return null;
  const host = world.services.find((service) => service.hostname === name.slice(0, at));
  if (host === undefined) return null;
  const key = name.slice(at + 1);
  if (host.kind === "other") return host.own.has(key) || host.system.has(key) ? PLATFORM : MISSING;
  if (host.system.has(key)) return PLATFORM;
  if (host.own.has(key))
    return {
      kind: "value",
      scope: scopeOf(host),
      key,
      value: host.own.get(key) ?? null,
      context: host,
    };
  // Another service's run entry: what it passes on is not followed here.
  if (host.entries.has(key)) return PLATFORM;
  return MISSING;
}

/** Where a name resolves inside a service, by the platform's precedence. */
function lookup(world: RefWorld, service: RefService, name: string): Target {
  if (service.system.has(name)) return PLATFORM;
  const template = service.entries.get(name);
  if (template !== undefined) return { kind: "entry", key: name, template };
  if (service.own.has(name))
    return service.kind === "other"
      ? PLATFORM
      : {
          kind: "value",
          scope: scopeOf(service),
          key: name,
          value: service.own.get(name) ?? null,
          context: service,
        };
  if (world.shared.has(name))
    return {
      kind: "value",
      scope: { kind: "shared" },
      key: name,
      value: world.shared.get(name) ?? null,
      context: service,
    };
  if (world.sharedSystem.has(name)) return PLATFORM;
  return elsewhere(world, name) ?? MISSING;
}

/** Whether an entry names itself: it, and every entry naming it, reach the app as literal text. */
const namesItself = (service: RefService, key: string): boolean =>
  parseRefs(service.entries.get(key) ?? "").includes(key);

/** Each reference of one run entry of a service, in order, and where it resolves. */
export function refsOf(
  world: RefWorld,
  service: RefService,
  entryKey: string,
): ReadonlyArray<VaultRef> {
  return parseRefs(service.entries.get(entryKey) ?? "").map((name): VaultRef => {
    if (name === entryKey) return { kind: "self", name };
    const target = lookup(world, service, name);
    switch (target.kind) {
      case "entry":
        return namesItself(service, target.key)
          ? { kind: "self", name }
          : { kind: "entry", name, key: target.key };
      case "value":
        return { kind: "value", name, scope: target.scope, key: target.key };
      case "platform":
        return { kind: "platform", name };
      case "missing":
        return { kind: "missing", name };
    }
  });
}

/**
 * The vault values a template reaches from a service: directly, through the entries it names, and
 * through plain values holding references (resolved where they live — Shared's where they are
 * read). A literal `${KEY}` reaches nothing; a cycle ends; a chain is followed eight steps deep.
 */
function reach(
  world: RefWorld,
  service: RefService,
  entryKey: string | null,
  template: string,
  seen: Set<string>,
  depth: number,
  into: Map<string, VaultScopeRef>,
): void {
  for (const name of parseRefs(template)) {
    if (name === entryKey) continue;
    const target = lookup(world, service, name);
    if (target.kind === "entry") {
      const id = `entry\u0000${service.serviceId}\u0000${target.key}`;
      if (depth >= MAX_DEPTH || seen.has(id)) continue;
      seen.add(id);
      reach(world, service, target.key, target.template, seen, depth + 1, into);
      continue;
    }
    if (target.kind !== "value") continue;
    const id = valueIdOf(target.scope, target.key);
    if (into.has(id)) continue;
    into.set(id, target.scope);
    if (target.value === null || depth >= MAX_DEPTH || !target.value.includes("${")) continue;
    reach(world, target.context, null, target.value, seen, depth + 1, into);
  }
}

/** The values one entry of a service reads, by value id. */
const readsOfEntry = (world: RefWorld, service: RefService, key: string, template: string) => {
  const into = new Map<string, VaultScopeRef>();
  if (!namesItself(service, key))
    reach(
      world,
      service,
      key,
      template,
      new Set([`entry\u0000${service.serviceId}\u0000${key}`]),
      0,
      into,
    );
  return into;
};

/**
 * Who reads each vault value at run, by value id (`valueIdOf`): every runtime service one of
 * whose entries reaches it, with those entries' keys. Readers by hostname, keys sorted.
 */
export function readersOf(
  world: RefWorld,
): ReadonlyMap<string, ReadonlyArray<Omit<VaultReader, "state">>> {
  const readers = new Map<string, Map<string, { service: RefService; via: Set<string> }>>();
  for (const service of world.services) {
    if (service.kind !== "runtime") continue;
    for (const [key, template] of service.entries)
      for (const id of readsOfEntry(world, service, key, template).keys()) {
        const byService = readers.get(id) ?? new Map();
        readers.set(id, byService);
        const reader = byService.get(service.serviceId) ?? { service, via: new Set<string>() };
        byService.set(service.serviceId, reader);
        reader.via.add(key);
      }
  }
  return new Map(
    [...readers].map(([id, byService]) => [
      id,
      [...byService.values()]
        .sort((left, right) => left.service.hostname.localeCompare(right.service.hostname))
        .map(({ service, via }) => ({
          serviceId: service.serviceId,
          hostname: service.hostname,
          via: [...via].sort(),
        })),
    ]),
  );
}

/**
 * Whether a reader runs a value: its containers started after the value last changed (`live`),
 * before it (`restart`), or either moment is unknown.
 */
export function readerState(
  startedAt: string | null,
  changedAt: string | null,
): VaultReader["state"] {
  if (startedAt === null || changedAt === null) return "unknown";
  const started = Date.parse(startedAt);
  const changed = Date.parse(changedAt);
  if (Number.isNaN(started) || Number.isNaN(changed)) return "unknown";
  return changed > started ? "restart" : "live";
}
