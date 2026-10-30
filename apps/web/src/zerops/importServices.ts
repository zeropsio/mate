/**
 * Importing services into a project, as the account's `import-services` operation with the
 * person's own Zerops access: the release review's *Create in production*. Resolves once Zerops
 * took the import; rejects with what to tell the person.
 */
import { useCallback } from "react";

import { useAccountOperations } from "./accountOperations";
import { importTrouble } from "./releaseImport.logic";
import { useAccountData } from "./ZeropsAccountData";

export function useImportServices(): (projectId: string, yaml: string) => Promise<void> {
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  return useCallback(
    async (projectId, yaml) => {
      if (orgId === null) throw new Error("No organization is open.");
      const { requestId } = await operations.submit({
        kind: "import-services",
        orgId,
        projectId,
        yaml,
      });
      const trouble = importTrouble(await operations.untilEnd(requestId, orgId));
      if (trouble !== null) throw new Error(trouble);
    },
    [operations, orgId],
  );
}
