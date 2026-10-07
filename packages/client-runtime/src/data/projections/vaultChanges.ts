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

/** A value held now: who runs the version before its last write until they restart. */
const heldImpact = (readers: ReadonlyArray<VaultReader>): VaultImpact => ({
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
        impact: heldImpact(value.readers),
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
  const { impact, key } = change;
  if (change.kind === "removed") {
    if (impact.literal.length > 0)
      return `${reads(impact.literal)} — ${impact.literal.length === 1 ? "it now gets" : "they now get"} the literal text \${${key}}; stop using it`;
    if (impact.restart.length > 0)
      return `${reads(impact.restart)} — it runs Shared's ${key} after a restart; restart ${names(impact.restart)}`;
    return "nothing read it";
  }
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
