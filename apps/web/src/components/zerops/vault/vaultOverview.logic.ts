/**
 * A vault at a glance, for a card that leads to it (a place's page): its parts by the panel's own
 * names and order, how many values each holds and how many of them are hidden, and what needs the
 * person in the panel's own sentences. Names and counts only: never a value.
 *
 * Pure: no React.
 */
import type { VaultView } from "@t3tools/client-runtime/data";

import { notLiveLine } from "./vault.logic";
import { unsetTitle, vaultGroups, vaultNeeds, vaultSections } from "./vaultGroups.logic";

/** One part of the vault the person owns: what every app gets, or one app's own values. */
export interface VaultOverviewPart {
  /** Its scope's id, which the panel's list names it by (`data-vault-part`). */
  readonly id: string;
  /** As the panel titles it (`vaultSections`). */
  readonly title: string;
  /** "6 values · 4 hidden", "1 value". */
  readonly counts: string;
}

/** One thing that needs the person, as the panel says it. */
export interface VaultOverviewNeed {
  readonly kind: "not-live" | "unset";
  readonly text: string;
}

export type VaultOverview =
  /** Not read yet: nothing is known of it. */
  | { readonly state: "reading" }
  /** It could not be read and nothing earlier is held. */
  | { readonly state: "unreadable" }
  | {
      readonly state: "read";
      /** None where the vault holds nothing of the person's. */
      readonly parts: ReadonlyArray<VaultOverviewPart>;
      readonly needs: ReadonlyArray<VaultOverviewNeed>;
    };

const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** "6 values · 4 hidden"; the hidden ones said only where there are any. */
export function valueCounts(values: number, hidden: number): string {
  const all = count(values, "value", "values");
  return hidden === 0 ? all : `${all} · ${String(hidden)} hidden`;
}

/**
 * The vault's overview. The services Zerops runs (a database, a cache) are left out: their values
 * are not the person's. What needs the person is the panel's own reading: values an app still runs
 * the old one of (`notLiveLine`), and values that are empty (`vaultNeeds`).
 */
export function vaultOverview(view: VaultView): VaultOverview {
  const parts = vaultSections(view, "").sections.map((section): VaultOverviewPart => ({
    id: section.scope.id,
    title: section.title,
    counts: valueCounts(
      section.entries.length,
      section.entries.filter((entry) => entry.value.sensitive).length,
    ),
  }));
  // What an earlier answer said is kept through a failed read, and still shown.
  if (parts.length === 0 && view.status !== "ready")
    return { state: view.status === "failed" ? "unreadable" : "reading" };
  const notLive = notLiveLine(view.notLive, null);
  const { unset } = vaultNeeds(vaultGroups(view, { kind: "everything" }, ""));
  return {
    state: "read",
    parts,
    needs: [
      ...(notLive === null ? [] : [{ kind: "not-live" as const, text: notLive.text }]),
      ...(unset.length === 0 ? [] : [{ kind: "unset" as const, text: unsetTitle(unset) }]),
    ],
  };
}
