import { createContext, useContext } from "react";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidateServiceOutcome } from "@t3tools/client-runtime/zerops/candidateLoading";
export interface Inventory {
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly services: ReadonlyMap<string, ZeropsCandidateServiceOutcome>;
  readonly isLoading: boolean;
  readonly error: string | null;
}
export const InventoryContext = createContext<Inventory | null>(null);

export function useZeropsInventory(): Inventory {
  const inventory = useContext(InventoryContext);
  if (!inventory) throw new Error("Zerops inventory requires a verified account.");
  return inventory;
}
