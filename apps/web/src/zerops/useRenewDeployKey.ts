/**
 * Renewing an environment's deploy key from where its trouble is said: the person's client mints
 * a key for the environment's project alone and HQ keeps it (the account's `keep-deploy-key`
 * operation), followed to its end. Zerops makes the key only for someone with admin access to
 * that project, so anyone else gets no press. One hook for every surface that offers it, so each
 * says the same of who may, of a renewal under way and of one that failed.
 */
import { useState } from "react";

import { randomUUID } from "~/lib/utils";

import { useAccountOperationsOptional } from "./accountOperations";
import { keyRenewTrouble, NOT_RENEWING, type KeyRenewal } from "./renewDeployKey.logic";
import { useProjectCapabilities } from "./usePlatformCapabilities";
import { useAccountOrgId } from "./ZeropsAccountData";

export interface RenewDeployKey {
  readonly run: KeyRenewal;
  /** Absent for a person without admin access to the project, and while the environment is not known. */
  readonly onRenew: (() => void) | undefined;
  /** Forgets how the last renewal ended. */
  readonly reset: () => void;
}

export function useRenewDeployKey(
  environment:
    | {
        /** The application whose environment it is. */
        readonly appId: string;
        /** The environment's Zerops project, which the key is granted on alone. */
        readonly projectId: string;
        /** Its name, as HQ names it. */
        readonly name: string;
        /** How the person names it in a sentence: "production", "the stage". */
        readonly place: string;
      }
    | undefined,
): RenewDeployKey {
  const operations = useAccountOperationsOptional();
  const orgId = useAccountOrgId();
  const access = useProjectCapabilities(environment?.projectId);
  const [run, setRun] = useState<KeyRenewal>(NOT_RENEWING);
  const renew =
    environment === undefined ||
    operations === null ||
    orgId === null ||
    (access.projectAccessKnown && !access.administer)
      ? undefined
      : async () => {
          if (run.kind === "working") return;
          setRun({ kind: "working" });
          try {
            const requestId = randomUUID();
            await operations.submit(
              {
                kind: "keep-deploy-key",
                orgId,
                appId: environment.appId,
                projectId: environment.projectId,
                environmentName: environment.name,
              },
              requestId,
            );
            const trouble = keyRenewTrouble(
              await operations.untilEnd(requestId, orgId),
              environment.place,
            );
            setRun(trouble === null ? { kind: "renewed" } : { kind: "failed", words: trouble });
          } catch (cause) {
            setRun({
              kind: "failed",
              words: cause instanceof Error ? cause.message : "It could not be carried out.",
            });
          }
        };
  return {
    run,
    onRenew:
      renew === undefined
        ? undefined
        : () => {
            void renew();
          },
    reset: () => setRun(NOT_RENEWING),
  };
}
