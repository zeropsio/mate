/**
 * A result row's Restart: the apps that run a value's old copy restart, so they use the new one.
 * Each is one `service-restart` the person asks for; the row goes once the vault says each runs
 * the value it holds now.
 */
import { use, useState } from "react";

import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { Spinner } from "../ui/spinner";
import type { VaultAskRestart } from "../zerops/vault/vaultRequest.logic";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineContext";
import { Button } from "~/components/ui/button";

export function RestartAction({ services }: { readonly services: ReadonlyArray<VaultAskRestart> }) {
  const row = use(TimelineRowCtx) as TimelineRowSharedState | null;
  const project = useZeropsEnvironmentProject(row?.threadRef?.environmentId ?? null);
  const operations = useAccountOperationsOptional();
  const [busy, setBusy] = useState(false);
  if (operations === null || project === undefined || services.length === 0) return null;
  const restart = async () => {
    setBusy(true);
    try {
      await Promise.all(
        services.map((service) =>
          operations.submit({
            kind: "service-restart",
            orgId: project.orgId,
            projectId: project.projectId,
            serviceId: service.serviceId,
          }),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      aria-label={`Restart ${services.map((service) => service.hostname).join(" and ")}`}
      size="sm"
      variant="link"
      disabled={busy}
      onClick={() => void restart()}
    >
      {busy ? <Spinner size="xs" /> : null}
      Restart
    </Button>
  );
}
