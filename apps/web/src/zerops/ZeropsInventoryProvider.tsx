import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { inventory, inventoryContents, NOT_READ_INVENTORY } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { zeropsSessionAtom } from "../state/zerops";
import { useAccountData } from "./ZeropsAccountData";
import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { inventoryTroubleVoice } from "./inventoryTrouble.logic";
import { HeldInventoryContext, InventoryContext, AccountTroubleContext } from "./inventoryContext";
export { useZeropsInventory } from "./inventoryContext";

const UNREAD_INVENTORY = Atom.make(NOT_READ_INVENTORY);

/** The session is already verified. Navigation renders its own coverage, without a second grant gate. */
export function ZeropsInventoryProvider({ children }: { readonly children: ReactNode }) {
  const { activeOrganization, organizationStatus, status } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const registry = useContext(RegistryContext);
  const account = useAccountData();
  const read = useAtomValue(
    useMemo(
      () =>
        activeOrganization === null
          ? UNREAD_INVENTORY
          : account.data.project(inventoryContents, {
              organization: organizationRef(activeOrganization.id),
              viewer: activeOrganization,
            }),
      [account.data, activeOrganization, organizationRef],
    ),
  );
  useEffect(() => {
    registry.set(zeropsSessionAtom, {
      status,
      organizationStatus,
      activeOrganization:
        activeOrganization === null ? null : organizationRef(activeOrganization.id),
    });
  }, [registry, status, organizationStatus, activeOrganization, organizationRef]);
  const held = useMemo(() => ({ projects: read.projects }), [read.projects]);
  return (
    <InventoryContext value={read}>
      <HeldInventoryContext value={held}>
        <InventoryTroubleProvider>{children}</InventoryTroubleProvider>
      </HeldInventoryContext>
    </InventoryContext>
  );
}

/** Only the account line subscribes to connection recovery. */
function InventoryTroubleProvider({ children }: { readonly children: ReactNode }) {
  const { activeOrganization } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  const account = useAccountData();
  const read = useAtomValue(
    useMemo(
      () =>
        activeOrganization === null
          ? UNREAD_INVENTORY
          : account.data.project(inventory, {
              organization: organizationRef(activeOrganization.id),
              viewer: activeOrganization,
            }),
      [account.data, activeOrganization, organizationRef],
    ),
  );
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
  return <AccountTroubleContext value={trouble}>{children}</AccountTroubleContext>;
}
