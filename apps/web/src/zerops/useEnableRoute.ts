/**
 * Opening a service to the internet, from wherever its addresses are listed.
 *
 * Zerops gives a service a subdomain on request; until somebody asks, the
 * service answers only inside the project. The ask lived on the projects
 * screen's row menu, so an environment's own page — the page with a *Where it
 * answers* section on it — could list the addresses it already had and could
 * not add one.
 *
 * It needs nothing that screen has and other surfaces do not: the active
 * organization and the runtime's command factory, both from context. The
 * trouble it reports is the caller's to show, because where a failed write
 * belongs depends on the surface.
 */
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useState } from "react";

import { captureAccountLifetime } from "./accountLifetime";
import { runZeropsCommand, useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface EnableRoute {
  /** Asks Zerops for the service's subdomain. */
  readonly enable: (projectId: string, serviceId: string) => Promise<void>;
  /** Which service is being opened, so its own row says so and takes no second press. */
  readonly enablingServiceId: string | null;
  /** Why the last one failed; `null` when none did. */
  readonly trouble: string | null;
}

export function useEnableRoute(): EnableRoute {
  const { activeOrganization } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();
  const [enablingServiceId, setEnablingServiceId] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const enable = useCallback(
    async (projectId: string, serviceId: string) => {
      if (enablingServiceId !== null || activeOrganization === null) return;
      // A sign-out mid-flight must not write state back onto the next account.
      const isCurrent = captureAccountLifetime();
      setEnablingServiceId(serviceId);
      setTrouble(null);
      try {
        await runZeropsCommand(
          runtime.commands.enableSubdomainAccess({
            kind: "service",
            project: projectRef(activeOrganization.id, projectId),
            serviceId: ZeropsServiceId.make(serviceId),
          }),
        );
      } catch (cause) {
        if (isCurrent()) setTrouble(zeropsErrorMessage(cause));
      } finally {
        if (isCurrent()) setEnablingServiceId(null);
      }
    },
    [activeOrganization, enablingServiceId, projectRef, runtime.commands],
  );

  return { enable, enablingServiceId, trouble };
}
