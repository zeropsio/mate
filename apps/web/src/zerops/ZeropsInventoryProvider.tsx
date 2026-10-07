import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { platformInventory } from "@t3tools/client-runtime/data";
import { placeProjects } from "@t3tools/client-runtime/zerops/hq";
import type { ProjectRef, ScopeAuthority } from "@t3tools/client-runtime/zerops/data";
import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { hqPlacementsAtom, zeropsInventoryAtom, zeropsSessionAtom } from "../state/zerops";
import { useAccountData } from "./ZeropsAccountData";
import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { inventoryTroubleVoice } from "./inventoryTrouble.logic";
import {
  HeldInventoryContext,
  InventoryContext,
  AccountTroubleContext,
  inventoryProjectRefKey,
  type Inventory,
} from "./inventoryContext";
export { useZeropsInventory } from "./inventoryContext";

/** The session is already verified. Navigation renders its own coverage, without a second grant gate. */
export function ZeropsInventoryProvider({ children }: { readonly children: ReactNode }) {
  const { activeOrganization, organizationStatus, status } = useZeropsSession();
  const { organizationRef, projectRef } = useZeropsData();
  const registry = useContext(RegistryContext);
  const account = useAccountData();
  const read = useAtomValue(
    useMemo(
      () =>
        account.data.project(platformInventory, {
          orgId: activeOrganization?.id ?? "",
          viewer: activeOrganization ?? undefined,
        }),
      [account.data, activeOrganization],
    ),
  );
  const placements = useAtomValue(hqPlacementsAtom);
  const snapshot = useMemo<Inventory>(() => {
    const refs = new Map<string, ProjectRef>();
    for (const project of read.projects) {
      const ref = projectRef(activeOrganization?.id ?? "", project.id);
      refs.set(inventoryProjectRefKey(ref), ref);
    }
    const authority = new Map<string, ScopeAuthority>(
      [...refs.keys()].map((key) => [key, { kind: "authorized" }]),
    );
    for (const id of read.denied) {
      const ref = projectRef(activeOrganization?.id ?? "", id);
      const key = inventoryProjectRefKey(ref);
      refs.set(key, ref);
      authority.set(key, { kind: "withheld", reason: "access-denied", cause: null });
    }
    return {
      projects: placements === null ? read.projects : placeProjects(read.projects, placements),
      projectRefs: refs,
      authority,
      lost: new Set(read.denied),
      isLoading: read.read !== "read",
      error: read.failure,
    };
  }, [read, placements, projectRef, activeOrganization?.id]);
  useEffect(() => {
    registry.set(zeropsSessionAtom, {
      status,
      organizationStatus,
      activeOrganization:
        activeOrganization === null ? null : organizationRef(activeOrganization.id),
    });
    registry.set(zeropsInventoryAtom, snapshot);
  }, [registry, status, organizationStatus, activeOrganization, organizationRef, snapshot]);
  const trouble = useMemo(
    () => ({
      trouble: inventoryTroubleVoice(read.trouble),
      unanswered: !read.live,
      subject:
        read.trouble === null
          ? null
          : `${activeOrganization?.name ?? "Zerops"}'s projects and services`,
      retry: account.retry,
    }),
    [read.live, read.trouble, activeOrganization?.name, account.retry],
  );
  return (
    <InventoryContext value={snapshot}>
      <HeldInventoryContext value={snapshot}>
        <AccountTroubleContext value={trouble}>{children}</AccountTroubleContext>
      </HeldInventoryContext>
    </InventoryContext>
  );
}
