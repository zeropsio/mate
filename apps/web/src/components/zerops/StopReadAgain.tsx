import { DEPLOYMENT_SURFACE } from "@t3tools/client-runtime/zerops/flow";
import { knownPresentation } from "@t3tools/client-runtime/zerops/knowledge";
import * as Effect from "effect/Effect";
import { useContext, useState } from "react";

import { againStopDeployment } from "~/zerops/accountForge";
import { invalidateZerops } from "~/zerops/accountInvalidations";
import { findInventoryProjectRef, InventoryContext } from "~/zerops/inventoryContext";
import { useZeropsProjectFlowOptional } from "~/zerops/projectFlowContext";
import { ZeropsDataContext } from "~/zerops/zeropsDataContext";
import { Button } from "../ui/button";

/** One manual attempt on the shared runtime projection, beside the failure it reports. */
export function StopReadAgain({ projectId }: { readonly projectId: string }) {
  const inventory = useContext(InventoryContext);
  const data = useContext(ZeropsDataContext);
  const flow = useZeropsProjectFlowOptional();
  const [running, setRunning] = useState(false);
  const deployment = flow?.deployments.get(projectId);
  if (deployment === undefined || inventory === null || data === null) return null;
  const presentation = knownPresentation(deployment, DEPLOYMENT_SURFACE, {
    nowMs: 0,
    updateOffered: false,
  });
  const action = presentation.affordance?.kind ?? presentation.banner?.affordance?.kind;
  const renewAccess =
    action === "renew-access" ||
    (deployment.state === "withheld" && deployment.reason === "access-denied");
  if (action !== "retry" && action !== "retry-now" && !renewAccess) return null;
  const project = findInventoryProjectRef(inventory, projectId);
  if (project === null) return null;
  return (
    <Button
      size="compact"
      variant="outline"
      disabled={running}
      onClick={() => {
        if (running) return;
        setRunning(true);
        if (renewAccess) invalidateZerops({ topic: "access", change: "renew-now" });
        againStopDeployment(project);
        void Effect.runPromise(data.runtime.refresh(project)).finally(() => setRunning(false));
      }}
    >
      Again
    </Button>
  );
}
