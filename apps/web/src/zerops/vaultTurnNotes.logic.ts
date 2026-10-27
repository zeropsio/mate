/**
 * What a Mate is told of its vault with the next message: the person's own writes from this client
 * not yet told — whenever they were made, a write during the agent's turn included — and the
 * changes the platform shows since the agent last spoke, from anywhere else. One per value, minus
 * the ones the person set aside or already sent. Never a value: the note names keys and what each
 * change needs.
 *
 * Pure: no network, no clock.
 */
import type { VaultChange } from "@t3tools/client-runtime/data";

const scopeIdOf = (change: Pick<VaultChange, "scope">): string =>
  change.scope.kind === "shared" ? "shared" : change.scope.serviceId;

/** Which value a change is of. */
export const vaultValueIdOf = (change: Pick<VaultChange, "scope" | "key">): string =>
  `${scopeIdOf(change)}\u0000${change.key}`;

/** One change's identity: which value, which way, when. */
export const vaultChangeIdOf = (change: Pick<VaultChange, "scope" | "key" | "kind" | "at">) =>
  `${vaultValueIdOf(change)}\u0000${change.kind}\u0000${change.at}`;

/**
 * The changes to tell, oldest first: per value the platform's word where it has one (its times are
 * the platform's), else the person's own write; none the person set aside or already sent.
 */
export function vaultTurnChanges(input: {
  /** This client's writes not yet told. */
  readonly own: ReadonlyArray<VaultChange>;
  /** What the platform shows changed since the agent last spoke; none before it has. */
  readonly since: ReadonlyArray<VaultChange>;
  /** Changes set aside or sent, by `vaultChangeIdOf`. */
  readonly hidden: ReadonlySet<string>;
}): ReadonlyArray<VaultChange> {
  const byValue = new Map<string, VaultChange>();
  for (const change of input.own) byValue.set(vaultValueIdOf(change), change);
  // The platform's word on a value replaces the client's — except a removal, which it cannot show.
  for (const change of input.since) byValue.set(vaultValueIdOf(change), change);
  return [...byValue.values()]
    .filter((change) => !input.hidden.has(vaultChangeIdOf(change)))
    .sort(
      // Times come from the platform (seconds) and this client (milliseconds): compared as times.
      (left, right) =>
        Date.parse(left.at) - Date.parse(right.at) || left.key.localeCompare(right.key),
    );
}

/**
 * The person's writes still to tell once one more is made: one per value. A value added and removed
 * before it was told is no news at all; one added and then changed is still news of its adding.
 */
export function heldWrites(
  held: ReadonlyArray<VaultChange>,
  change: VaultChange,
): ReadonlyArray<VaultChange> {
  const id = vaultValueIdOf(change);
  const before = held.find((each) => vaultValueIdOf(each) === id);
  const rest = held.filter((each) => vaultValueIdOf(each) !== id);
  if (before?.kind === "added" && change.kind === "removed") return rest;
  if (before?.kind === "added" && change.kind === "changed")
    return [...rest, { ...change, kind: "added" }];
  return [...rest, change];
}

const VERB: Readonly<Record<VaultChange["kind"], string>> = {
  added: "added",
  changed: "changed",
  removed: "removed",
};

/** A chip's words: the key and what happened to it. */
export const vaultChipLabel = (change: Pick<VaultChange, "key" | "kind">): string =>
  `${change.key} ${VERB[change.kind]}`;

/** The message a send of the chips alone carries: the keys, never a value. */
export function vaultChipsOnlyText(changes: ReadonlyArray<Pick<VaultChange, "key">>): string {
  const keys = [...new Set(changes.map((change) => change.key))];
  return `I updated the vault: ${keys.join(", ")}.`;
}
