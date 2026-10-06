/**
 * The account's registry — which applications exist and which projects are in them — as the
 * organization's HQ streams it (`hqStructure.ts`, ADR 0002), shared by every surface that reads
 * it: one stream, never a read per surface.
 *
 * An empty structure from HQ is an organization with no applications yet: the empty registry,
 * known. An organization with no HQ never reaches here — the HQ gate stands before the product
 * (`hqGate.ts`). While nothing is known yet — HQ not answered and nothing remembered — it is
 * loading, never the empty registry settled, which would drop every group from the tree. HQ down
 * leaves the registry last known standing.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  EMPTY_REGISTRY,
  registryFromHq,
  type ZeropsRegistry,
} from "@t3tools/client-runtime/zerops/hq";
import { useMemo } from "react";

import { hqNavigationAtom } from "../state/zerops";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface ZeropsRegistryState {
  readonly registry: ZeropsRegistry;
  /** True until the organization in view's structure is known. */
  readonly loading: boolean;
}

export function useZeropsRegistry(): ZeropsRegistryState {
  const { activeOrganization } = useZeropsSession();
  const view = useAtomValue(hqNavigationAtom);
  const structure = view.orgId === activeOrganization?.id ? view.structure : null;
  return useMemo(
    () =>
      structure === null
        ? { registry: EMPTY_REGISTRY, loading: true }
        : { registry: registryFromHq(structure), loading: false },
    [structure],
  );
}
