/**
 * What a vault write means for the services that read the value, read off the view at once, and
 * the changes since a moment as the note a Mate's agent hears at its next turn: keys, scopes,
 * plain or sensitive, and what each needs to be live — never a value.
 *
 * @module data/projections/vaultChanges
 */
import type {
  VaultChange,
  VaultImpact,
  VaultReader,
  VaultRestarts,
  VaultScope,
  VaultScopeRef,
  VaultValue,
  VaultView,
  VaultWrite,
} from "./vaultModel.ts";

type ServiceName = VaultImpact["restart"][number];

const sameScope = (left: VaultScopeRef, right: VaultScopeRef) =>
  left.kind === "shared"
    ? right.kind === "shared"
    : right.kind === "service" && left.serviceId === right.serviceId;

const scopeIn = (view: VaultView, ref: VaultScopeRef): VaultScope | undefined =>
  view.scopes.find((scope) => sameScope(scope.ref, ref));

const nameOf = ({ serviceId, hostname }: ServiceName): ServiceName => ({ serviceId, hostname });

/** Services once each, by hostname. */
function servicesOf(list: ReadonlyArray<ServiceName>): ReadonlyArray<ServiceName> {
  const byId = new Map(list.map((service) => [service.serviceId, nameOf(service)]));
  return [...byId.values()].sort((left, right) => left.hostname.localeCompare(right.hostname));
}

/** An impact read off a view: where it was not whole, it claims no absence. */
const asRead = (view: VaultView, impact: VaultImpact): VaultImpact =>
  view.complete ? impact : { ...impact, unread: false, partial: true };

/** A value held now: who runs the version before its last write until they restart. */
const heldImpact = (view: VaultView, readers: ReadonlyArray<VaultReader>): VaultImpact =>
  asRead(view, {
    restart: servicesOf(readers.filter((reader) => reader.state !== "live")),
    unread: readers.length === 0,
    literal: [],
  });

/** The runtimes whose run entries would read a value added under `key` in `ref`. */
function wouldRead(view: VaultView, ref: VaultScopeRef, key: string): ReadonlyArray<ServiceName> {
  const owner = ref.kind === "service" ? scopeIn(view, ref) : undefined;
  const readers: ServiceName[] = [];
  for (const scope of view.scopes) {
    if (scope.kind !== "runtime" || scope.hostname === null) continue;
    const own = owner !== undefined && scope.id === owner.id;
    const reads = scope.reads.some((entry) =>
      entry.refs.some((each) => {
        if (ref.kind === "shared") return each.kind === "missing" && each.name === key;
        if (own && each.name === key)
          return each.kind === "missing" || (each.kind === "value" && each.scope.kind === "shared");
        return (
          owner?.hostname != null &&
          each.kind === "missing" &&
          each.name === `${owner.hostname}_${key}`
        );
      }),
    );
    if (reads) readers.push({ serviceId: scope.id, hostname: scope.hostname });
  }
  return servicesOf(readers);
}

/** What a write to one vault means for the services that read the value. */
export function vaultImpact(view: VaultView, ref: VaultScopeRef, write: VaultWrite): VaultImpact {
  return asRead(view, impactOn(view, ref, write));
}

function impactOn(view: VaultView, ref: VaultScopeRef, write: VaultWrite): VaultImpact {
  const scope = scopeIn(view, ref);
  const held: VaultValue | undefined =
    write.kind === "add"
      ? scope?.values.find((each) => each.key === write.key)
      : scope?.values.find((each) => each.id === write.id);
  if (write.kind === "add" && held === undefined) {
    const restart = wouldRead(view, ref, write.key);
    return { restart, unread: restart.length === 0, literal: [] };
  }
  const readers = held?.readers ?? [];
  if (write.kind !== "remove")
    return { restart: servicesOf(readers), unread: readers.length === 0, literal: [] };
  // A service's own value removed: the service itself runs Shared's of that key, if there is one.
  const fallsBack =
    ref.kind === "service" &&
    (scopeIn(view, { kind: "shared" })?.values.some((each) => each.key === write.key) ?? false);
  const own = (reader: VaultReader) => ref.kind === "service" && reader.serviceId === ref.serviceId;
  return {
    restart: fallsBack ? servicesOf(readers.filter(own)) : [],
    unread: readers.length === 0,
    literal: servicesOf(readers.filter((reader) => !(fallsBack && own(reader)))),
  };
}

/** Whether a run entry of a runtime is one of its zerops.yml entries (not a name it has by itself). */
const isEntryOf = (scope: VaultScope | undefined, key: string) =>
  scope?.reads.some((entry) => entry.key === key) ?? false;

/** Whether a reader reads a value through one of its zerops.yml entries, not only by its name. */
const throughEntry = (view: VaultView, reader: VaultReader) =>
  reader.via.some((key) => isEntryOf(scopeIn(view, serviceRef(reader.serviceId)), key));

/**
 * The runtimes a write to `ref` restarts. Those whose zerops.yml entries reference the value, else
 * — nothing referencing it, and `byName` — every one that has it by its own name, as the platform
 * hands a Shared value to every service and a service's own to that service, unless an entry, or
 * the service's own value over Shared, of that name shadows it. A removal restarts no reader that
 * references it through an entry — it would start on the literal `${KEY}` — unless a service's own
 * value gives way to Shared's of that key.
 */
function readersToRestart(
  view: VaultView,
  ref: VaultScopeRef,
  write: VaultWrite,
  byName: boolean,
): ReadonlyArray<ServiceName> {
  const scope = scopeIn(view, ref);
  const held =
    write.kind === "add"
      ? scope?.values.find((each) => each.key === write.key)
      : scope?.values.find((each) => each.id === write.id);
  if (held !== undefined) {
    const referencing = held.readers.filter((reader) => throughEntry(view, reader));
    const named = byName ? held.readers.filter((reader) => !throughEntry(view, reader)) : [];
    if (write.kind !== "remove")
      return servicesOf(referencing.length > 0 || !byName ? referencing : held.readers);
    const fallsBack =
      ref.kind === "service" &&
      (scopeIn(view, { kind: "shared" })?.values.some((each) => each.key === write.key) ?? false);
    return servicesOf(fallsBack ? held.readers : named);
  }
  if (write.kind === "remove") return [];
  const referencing = wouldRead(view, ref, write.key);
  if (referencing.length > 0 || !byName) return referencing;
  return servicesOf(
    view.scopes
      .filter(
        (each) =>
          each.kind === "runtime" &&
          each.hostname !== null &&
          (ref.kind === "shared" || each.id === ref.serviceId) &&
          !isEntryOf(each, write.key) &&
          !(ref.kind === "shared" && each.values.some((value) => value.key === write.key)),
      )
      .map((each) => ({ serviceId: each.id, hostname: each.hostname ?? each.id })),
  );
}

const serviceRef = (serviceId: string): VaultScopeRef => ({ kind: "service", serviceId });

/**
 * The runtimes a removal leaves starting on the literal `${KEY}`: those that reference the value
 * through an entry, while nothing of that key takes its place. What its confirm warns of.
 */
export function vaultRemovalBreaks(
  view: VaultView,
  ref: VaultScopeRef,
  valueId: string,
): ReadonlyArray<ServiceName> {
  const held = scopeIn(view, ref)?.values.find((each) => each.id === valueId);
  if (held === undefined) return [];
  const fallsBack =
    ref.kind === "service" &&
    (scopeIn(view, { kind: "shared" })?.values.some((each) => each.key === held.key) ?? false);
  return fallsBack ? [] : servicesOf(held.readers.filter((reader) => throughEntry(view, reader)));
}

/**
 * What restarts after writes to one project's vault, read off the view before them: each service
 * that reads a written value once, however many changed — a running one restarts; one that runs
 * nothing, or one the view does not know, is named instead; one whose deploy is under way starts
 * with it — plus the services a caller names (the Mate's own list for a stage or production
 * value), held to the same. `byName` false (the Mate's own project, where a restart stops the
 * agent's dev servers) restarts only the services whose entries reference what changed.
 */
export function vaultRestarts(
  view: VaultView,
  writes: ReadonlyArray<{ readonly scope: VaultScopeRef; readonly write: VaultWrite }>,
  named: ReadonlyArray<ServiceName> = [],
  options: { readonly byName?: boolean } = {},
): VaultRestarts {
  const byName = options.byName ?? true;
  const readers = servicesOf([
    ...writes.flatMap(({ scope, write }) => readersToRestart(view, scope, write, byName)),
    ...named,
  ]);
  const held = (service: ServiceName) => scopeIn(view, serviceRef(service.serviceId));
  return {
    restart: readers.filter(
      (service) => held(service)?.running === true && held(service)?.deploying !== true,
    ),
    notRunning: readers.filter((service) => held(service)?.running !== true),
    deploying: readers.filter(
      (service) => held(service)?.running === true && held(service)?.deploying === true,
    ),
  };
}

const after = (left: string | null, right: string) =>
  left !== null && Date.parse(left) > Date.parse(right);

/**
 * The person's vault changes since a moment: values added or changed (by the platform's times), and
 * the removals the caller kept (a removed value is no longer in the view), oldest first.
 */
export function vaultChangesSince(
  view: VaultView,
  since: string,
  removed: ReadonlyArray<{
    readonly scope: VaultScopeRef;
    readonly key: string;
    readonly sensitive: boolean;
    readonly at: string;
    readonly impact: VaultImpact;
  }>,
): ReadonlyArray<VaultChange> {
  const changes: VaultChange[] = [];
  for (const scope of view.scopes) {
    if (!scope.editable) continue;
    for (const value of scope.values) {
      const added = after(value.createdAt, since);
      if (!added && !after(value.changedAt, since)) continue;
      changes.push({
        scope: scope.ref,
        hostname: scope.hostname,
        key: value.key,
        kind: added ? "added" : "changed",
        sensitive: value.sensitive,
        at: (added ? value.createdAt : value.changedAt) ?? since,
        impact: heldImpact(view, value.readers),
      });
    }
  }
  for (const removal of removed)
    if (after(removal.at, since))
      changes.push({
        ...removal,
        // A service gone from the view since is named by its id, never as Shared.
        hostname:
          removal.scope.kind === "shared"
            ? null
            : (scopeIn(view, removal.scope)?.hostname ?? removal.scope.serviceId),
        kind: "removed",
      });
  return changes.sort(
    (left, right) =>
      Date.parse(left.at) - Date.parse(right.at) || left.key.localeCompare(right.key),
  );
}

const SIGN: Readonly<Record<VaultChange["kind"], string>> = {
  added: "+",
  changed: "~",
  removed: "−",
};

const names = (list: ReadonlyArray<ServiceName>) => list.map((each) => each.hostname).join(", ");
const reads = (list: ReadonlyArray<ServiceName>) =>
  `${names(list)} ${list.length === 1 ? "reads" : "read"} it`;

function impactText(change: VaultChange): string {
  const restarted = change.restarted ?? [];
  if (restarted.length === 0) return impactBefore(change);
  if (change.kind === "removed")
    return change.impact.literal.length > 0
      ? `restarted ${names(restarted)}; ${impactBefore(change)}`
      : `restarted ${names(restarted)}, which now ${restarted.length === 1 ? "runs" : "run"} Shared's ${change.key}`;
  const left = change.impact.restart.filter(
    (service) => !restarted.some((each) => each.serviceId === service.serviceId),
  );
  const done = `restarted ${names(restarted)}, which ${restarted.length === 1 ? "runs" : "run"} it`;
  return left.length === 0 ? done : `${done}; ${reads(left)} — restart ${names(left)}`;
}

/** What a change means before anything restarted. */
function impactBefore(change: VaultChange): string {
  const { impact, key } = change;
  if (change.kind === "removed") {
    if (impact.literal.length > 0)
      return `${reads(impact.literal)} — ${impact.literal.length === 1 ? "it now gets" : "they now get"} the literal text \${${key}}; stop using it`;
    if (impact.restart.length > 0)
      return `${reads(impact.restart)} — it runs Shared's ${key} after a restart; restart ${names(impact.restart)}`;
    return impact.partial === true
      ? "who read it is not known — the vault was not read whole"
      : "nothing read it";
  }
  if (impact.restart.length === 0 && impact.partial === true)
    return "who reads it is not known yet — the vault was not read whole";
  if (impact.unread)
    return "nothing reads it yet — reference it in zerops.yml where the app needs it, then deploy";
  if (impact.restart.length > 0)
    return `${reads(impact.restart)} at run — restart ${names(impact.restart)}`;
  return "read at run, live in every service that reads it";
}

/** The text a Mate's agent receives of the changes; `null` when there are none. */
export function vaultNote(changes: ReadonlyArray<VaultChange>): string | null {
  if (changes.length === 0) return null;
  return [
    "Vault changes since your last turn (values are never shown to you):",
    ...changes.map(
      (change) =>
        `${SIGN[change.kind]} ${change.key}  ${change.hostname ?? "Shared"} · ${change.sensitive ? "sensitive" : "plain"} · ${impactText(change)}`,
    ),
  ].join("\n");
}
