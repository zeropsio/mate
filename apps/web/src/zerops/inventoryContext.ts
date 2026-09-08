import { createContext, useContext } from "react";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import {
  deriveZeropsCandidates,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import { projectKeyOf, type ProjectRef } from "@t3tools/client-runtime/zerops/data";

export type InventoryServiceOutcome =
  | { readonly status: "resolved"; readonly services: ReadonlyArray<ZeropsService> }
  | { readonly status: "failed" };

export interface Inventory {
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly services: ReadonlyMap<string, InventoryServiceOutcome>;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Operable, account-scoped identities used to filter every shared projection. */
  readonly projectRefs: ReadonlyMap<string, ProjectRef>;
}

export function inventoryProjectRefKey(ref: ProjectRef): string {
  return projectKeyOf(ref);
}

export function findInventoryProjectRef(
  inventory: Inventory,
  projectId: string,
  organizationId?: string,
): ProjectRef | null {
  const matches = [...inventory.projectRefs.values()].filter(
    (ref) =>
      ref.projectId === projectId &&
      (organizationId === undefined || ref.organization.organizationId === organizationId),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
/**
 * Folds every inventory project against its resolved services into the flat
 * candidate list every consumer needs to find or classify an environment.
 * Group membership is never known here, so it is always the account-wide
 * fold (an empty group map) — a caller that also needs group tags derives
 * them from the same candidates afterward.
 */
export function deriveInventoryCandidates(
  projects: ReadonlyArray<ZeropsProject>,
  services: ReadonlyMap<string, InventoryServiceOutcome>,
): ReadonlyArray<ZeropsCandidate> {
  return projects.flatMap((project) => {
    const outcome = services.get(project.id);
    return deriveZeropsCandidates(
      project,
      outcome?.status === "resolved" ? outcome.services : null,
      new Map(),
    );
  });
}

export function inventoryCandidates(inventory: Inventory): ReadonlyArray<ZeropsCandidate> {
  return deriveInventoryCandidates(inventory.projects, inventory.services);
}

export const InventoryContext = createContext<Inventory | null>(null);

export function useZeropsInventory(): Inventory {
  const inventory = useContext(InventoryContext);
  if (!inventory) throw new Error("Zerops inventory requires a verified account.");
  return inventory;
}
