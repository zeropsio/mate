/**
 * Cancelling a pipeline's build from its dialog: the account's `cancel-build` operation. Its end is
 * the build's process, or the version, saying it is canceling or cancelled; until then the press
 * says it is cancelling and takes no second one. Why it failed is the caller's to show.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useState } from "react";

import { captureAccountLifetime } from "./accountLifetime";
import { useAccountOperations } from "./accountOperations";
import { useAccountData } from "./ZeropsAccountData";
import { submitZeropsWrite } from "./zeropsWrite";

export interface CancelBuild {
  readonly cancel: () => Promise<void>;
  readonly cancelling: boolean;
  /** Why the last one failed; `null` when none did. */
  readonly trouble: string | null;
}

export function useCancelBuild(input: {
  readonly projectId: string;
  readonly appVersionId: string;
  readonly processId: string | null;
}): CancelBuild {
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  const [cancelling, setCancelling] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const { projectId, appVersionId, processId } = input;
  const cancel = useCallback(async () => {
    if (cancelling || orgId === null) return;
    // A sign-out mid-flight must not write state back onto the next account.
    const isCurrent = captureAccountLifetime();
    setCancelling(true);
    setTrouble(null);
    try {
      await submitZeropsWrite(operations, orgId, {
        kind: "cancel-build",
        projectId,
        appVersionId,
        processId,
      });
    } catch (cause) {
      // Only a write Zerops did not take frees the press; a taken one stays cancelling until the
      // build says so, and the control leaves with the build.
      if (isCurrent()) {
        setTrouble(zeropsErrorMessage(cause));
        setCancelling(false);
      }
    }
  }, [appVersionId, cancelling, operations, orgId, processId, projectId]);
  return { cancel, cancelling, trouble };
}
