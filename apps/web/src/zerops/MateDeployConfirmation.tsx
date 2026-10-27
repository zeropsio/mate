import { useState } from "react";
import { projectNameInApp } from "@t3tools/client-runtime/zerops";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { RecoveryItems, useRecoveryCommand, useRecoveryFeedback } from "./recoveryOutcomes";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

/** Keeps the deployment receipt visible here, or in the shell after this dialog closes. */
export function MateDeployConfirmation({
  candidate,
  onClose,
}: {
  readonly candidate: ZeropsCandidatePresentation;
  readonly onClose: () => void;
}) {
  const command = useRecoveryCommand("deploy-confirmation");
  const { items } = useRecoveryFeedback(candidate.project.id, "deploy-confirmation");
  const [error, setError] = useState<string | null>(null);
  const latest = items.at(-1)?.outcome;
  const name = projectNameInApp(candidate.project);
  const pending = latest !== undefined && !latest.terminal && latest.retry.action === null;
  const deploy = () => {
    if (candidate.service === undefined) return;
    setError(null);
    void command(
      {
        key: candidate.key,
        projectId: candidate.project.id,
        serviceId: candidate.service.id,
        status: candidate.service.status,
        name,
      },
      "redeploy",
    ).catch((cause: unknown) => setError(zeropsErrorMessage(cause)));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Redeploy {name}</DialogTitle>
          <DialogDescription>
            Nothing is deployed yet. Redeploy to create this Mate's container.
          </DialogDescription>
        </DialogHeader>
        {items.length === 0 ? null : <RecoveryItems items={items} actions={false} />}
        {error === null ? null : (
          <DialogPanel>
            <p role="alert">{error}</p>
          </DialogPanel>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {latest === undefined ? "Cancel" : "Close"}
          </Button>
          {latest?.succeeded === true ? null : (
            <Button disabled={pending} onClick={deploy}>
              {pending ? "Redeploying…" : (latest?.retry.label ?? "Redeploy")}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
