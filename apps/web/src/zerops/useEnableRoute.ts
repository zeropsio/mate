/**
 * Opening a service to the internet, from wherever its addresses are listed.
 *
 * Zerops gives a service a subdomain on request; until somebody asks, the
 * service answers only inside the project. The ask lived on the projects
 * screen's row menu, so an environment's own page — the page with a *Where it
 * answers* section on it — could list the addresses it already had and could
 * not add one.
 *
 * It needs nothing that screen has and other surfaces do not: the account's
 * `enable-subdomain-access` operation, from context. The trouble it reports is
 * the caller's to show, because where a failed write belongs depends on the
 * surface. Its end is the service's pushed row turning its subdomain on, and the new address
 * arrives with the organization's routings: nothing is read again.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useState } from "react";

import { captureAccountLifetime } from "./accountLifetime";
import { useAccountOperations } from "./accountOperations";
import { useAccountData } from "./ZeropsAccountData";
import { submitZeropsWrite } from "./zeropsWrite";

export interface EnableRoute {
  /** Asks Zerops for the service's subdomain. */
  readonly enable: (projectId: string, serviceId: string) => Promise<void>;
  /** Which service is being opened, so its own row says so and takes no second press. */
  readonly enablingServiceId: string | null;
  /** Why the last one failed; `null` when none did. */
  readonly trouble: string | null;
}

export function useEnableRoute(): EnableRoute {
  const operations = useAccountOperations();
  const { orgId } = useAccountData();
  const [enablingServiceId, setEnablingServiceId] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const enable = useCallback(
    async (projectId: string, serviceId: string) => {
      if (enablingServiceId !== null || orgId === null) return;
      // A sign-out mid-flight must not write state back onto the next account.
      const isCurrent = captureAccountLifetime();
      setEnablingServiceId(serviceId);
      setTrouble(null);
      try {
        await submitZeropsWrite(operations, orgId, {
          kind: "enable-subdomain-access",
          projectId,
          serviceId,
        });
      } catch (cause) {
        if (isCurrent()) setTrouble(zeropsErrorMessage(cause));
      } finally {
        if (isCurrent()) setEnablingServiceId(null);
      }
    },
    [enablingServiceId, operations, orgId],
  );

  return { enable, enablingServiceId, trouble };
}
