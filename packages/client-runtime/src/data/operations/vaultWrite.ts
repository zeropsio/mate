/**
 * One write to one vault, at Zerops: a Shared value added, updated or removed
 * (`stack.updateProjectEnvs`), or a service's own (`stack.updateUserData`). The vault's own
 * variables are its evidence: the write is reflected once they show it — an added key there, a
 * removed row gone, an update's value (or, sensitive, its row written since the send) — and done
 * once its process has finished and they show it, or failed as its process failed. A lost answer
 * is resolved from that same evidence, never by adopting a process: a variables write runs ~1.5 s
 * and anyone's (zcp's, another tab's) looks alike. A write's value is never put in a reason, a
 * receipt, a handle or a log.
 *
 * @module data/operations/vaultWrite
 */
import { projectVariablesScope } from "../families/projectVariables.ts";
import { serviceVariablesScope } from "../families/serviceVariables.ts";
import type { OperationReceipt } from "../model.ts";
import type { VaultScopeRef, VaultWrite } from "../projections/vaultModel.ts";
import type { ProjectionReads } from "../store.ts";
import type { IntentOf, OperationKind, Settlement } from "./kind.ts";
import { historyHolding } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "vault-write": {
      /** The organization whose link observes the project. */
      readonly orgId: string;
      readonly projectId: string;
      readonly scope: VaultScopeRef;
      readonly write: VaultWrite;
    };
  }
}

type Intent = IntentOf<"vault-write">;

/** An effect handle: what the vault's variables show of a write, never its value. */
const EFFECT = "vault:";

interface Held {
  readonly id: string;
  readonly key: string;
  readonly sensitive: boolean;
  readonly value: string | null;
  readonly lastUpdate: string | null;
}

/** The vault as observed now; `null` when its contents cannot prove this write. */
function heldIn(
  read: ProjectionReads,
  { orgId, projectId, scope, write }: Intent,
): ReadonlyArray<Held> | null {
  const removing = write.kind === "remove";
  if (scope.kind === "shared") {
    const fact = read.fact("projectVariables", projectId);
    if (fact.kind !== "known") return null;
    // A readable target proves presence even when other rows are missing.
    if (removing && fact.value.rows.some((row) => row.id === write.id)) return fact.value.rows;
    const coverage = read.coverage(projectVariablesScope(orgId, projectId));
    if (coverage === "unknown" || (removing && (coverage !== "complete" || !fact.value.complete)))
      return null;
    return fact.value.rows;
  }
  const listing = read.members(serviceVariablesScope(orgId, projectId));
  // Deletion of this keyed row is owner evidence; deletion of the Shared aggregate is not.
  if (removing) {
    const target = read.fact("serviceVariable", write.id);
    if (target.kind === "deleted") return [];
    if (target.kind === "withheld") return null;
    if (
      target.kind === "known" &&
      target.value.serviceId === scope.serviceId &&
      listing.ids.includes(write.id)
    )
      return [{ id: write.id, ...target.value }];
  }
  if (listing.coverage === "unknown") return null;
  if (removing && (listing.coverage !== "complete" || listing.unverified.length > 0)) return null;
  const held: Held[] = [];
  for (const id of listing.ids) {
    const fact = read.fact("serviceVariable", id);
    if (fact.kind !== "known") {
      if (removing && fact.kind !== "deleted") return null;
      continue;
    }
    if (fact.value.serviceId === scope.serviceId) held.push({ id, ...fact.value });
  }
  return held;
}

/** What the vault shows of the write now, as handles: compared with what it showed at the send. */
function effectsOf(read: ProjectionReads, intent: Intent): ReadonlyArray<string> | null {
  const held = heldIn(read, intent);
  if (held === null) return intent.write.kind === "remove" ? null : [];
  const { write } = intent;
  switch (write.kind) {
    case "add": {
      const key = write.key.toLowerCase();
      return held.filter((row) => row.key.toLowerCase() === key).map((row) => `${EFFECT}${row.id}`);
    }
    case "remove":
      return held.some((row) => row.id === write.id) ? [] : [`${EFFECT}gone:${write.id}`];
    case "update": {
      const row = held.find((each) => each.id === write.id);
      if (row === undefined) return [];
      const shows = write.sensitive ? row.sensitive : !row.sensitive && row.value === write.value;
      // Its write time tells a write since the send from the value it held already.
      return shows ? [`${EFFECT}${row.id}@${row.lastUpdate ?? ""}`] : [];
    }
  }
}

/** Whether the vault shows the write: an effect it did not show at the send. */
function shown(read: ProjectionReads, intent: Intent, receipt: OperationReceipt): boolean {
  const before = read.operation(receipt.requestId)?.before;
  if (before == null && intent.write.kind === "remove") return false;
  return effectsOf(read, intent)?.some((handle) => !(before ?? []).includes(handle)) ?? false;
}

/** Whether a screen still observes the vault the write goes to. */
function observed(read: ProjectionReads, { orgId, projectId, scope }: Intent): boolean {
  const listing =
    scope.kind === "shared"
      ? projectVariablesScope(orgId, projectId)
      : serviceVariablesScope(orgId, projectId);
  return read.stream(listing).demanded;
}

const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

function settled(
  read: ProjectionReads,
  intent: Intent,
  receipt: OperationReceipt,
): Settlement | null {
  const handle = receipt.handles[0] ?? "";
  // Adopted after a lost answer: the vault showed it, which is its end.
  if (handle.startsWith(EFFECT)) return { kind: "succeeded" };
  const process = read.fact("process", handle);
  if (process.kind !== "known") return null;
  if (FAILED_STATUSES.has(process.value.status))
    return { kind: "failed", reason: `Saving ${intent.write.key} ended ${process.value.status}.` };
  if (process.value.status !== "FINISHED") return null;
  // Done once the vault shows it — or where no screen observes the vault any more, by its process.
  return shown(read, intent, receipt) || !observed(read, intent) ? { kind: "succeeded" } : null;
}

export const vaultWrite: OperationKind<"vault-write"> = {
  kind: "vault-write",
  executor: "zerops",
  reflected: shown,
  settledBy: settled,
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  effectHandles: effectsOf,
};
