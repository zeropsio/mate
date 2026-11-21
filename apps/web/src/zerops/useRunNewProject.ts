/** New project and Chief setup each submit one birth to HQ, which runs it. */
import { formatMateFace } from "@t3tools/client-runtime/zerops";
import { creationStepId } from "@t3tools/client-runtime/data";
import { useCallback } from "react";

import { useAccountOperations } from "./accountOperations";
import { newProjectIntent, type CreationAsk } from "./newProjectBirth";

/**
 * A Create hands one idempotent birth to HQ — an ordinary one, or the person's Chief (its intent
 * placed as a Chief, `newProjectIntent`). The creation reads the operation's answer.
 */
export function useCreateBirth(): (held: CreationAsk) => void {
  const operations = useAccountOperations();
  return useCallback(
    ({ ask }: CreationAsk) => {
      const orgId = ask.organizationId;
      const step = operations.readCreation(orgId, ask.birthId).steps.birth;
      if (step.state === "running" || step.state === "done") return;
      void operations.submit(
        {
          kind: "create-birth",
          orgId,
          id: ask.birthId,
          app: { name: ask.name },
          face: formatMateFace(ask.face),
          intent: newProjectIntent(ask),
        },
        creationStepId(ask.birthId, "birth", step.attempt + 1),
      );
    },
    [operations],
  );
}
