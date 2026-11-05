import type {
  AccountScope,
  OrganizationRef,
  ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import type { PlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import { createContext, useContext } from "react";

export interface ZeropsDataContextValue {
  readonly scope: AccountScope;
  /** The tab, as every consumer of the account hears it (DESIGN §6.4). */
  readonly signals: PlatformSignals;
  readonly organizationRef: (organizationId: string) => OrganizationRef;
  readonly projectRef: (organizationId: string, projectId: string) => ProjectRef;
}

export const ZeropsDataContext = createContext<ZeropsDataContextValue | null>(null);

export function useZeropsData(): ZeropsDataContextValue {
  const value = useContext(ZeropsDataContext);
  if (value === null) throw new Error("Zerops data requires a verified account.");
  return value;
}
