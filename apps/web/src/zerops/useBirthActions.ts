import { RegistryContext } from "@effect/atom-react";
import { accountReadsAtom, sharedBirthsAtom } from "@t3tools/client-runtime/data";
import { useCallback, useContext, useMemo } from "react";
import { randomUUID } from "~/lib/utils";

import { useAccountOperationsOptional } from "./accountOperations";
import { writeTrouble } from "./zeropsWrite";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** One account's birth actions; every decision is re-read from its shared projection at the write. */
export function useBirthActions() {
  const { activeOrganization, user } = useZeropsSession();
  const operations = useAccountOperationsOptional();
  const registry = useContext(RegistryContext);

  const deleteBirthOnly = useCallback(
    async (birthId: string) => {
      if (activeOrganization === null || user === null || operations === null) return;
      const orgId = activeOrganization.id;
      const birth =
        registry.get(accountReadsAtom)?.orgId === orgId
          ? registry.get(sharedBirthsAtom(user.id)).open.find((entry) => entry.id === birthId)
          : undefined;
      if (birth === undefined || birth.deletion !== undefined || !birth.offers.includes("delete"))
        throw new Error("The birth changed before it could be deleted.");
      const { progress, evidence } = await operations.submit({
        kind: "delete-birth",
        orgId,
        appId: birth.appId,
        birthId: birth.id,
        id: randomUUID(),
      });
      const trouble = writeTrouble(progress, evidence);
      if (trouble !== null) throw new Error(trouble);
    },
    [activeOrganization, operations, registry, user],
  );
  return useMemo(() => ({ deleteBirthOnly }), [deleteBirthOnly]);
}
