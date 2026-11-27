import { RegistryContext } from "@effect/atom-react";
import {
  birthDeletionAcknowledgementId,
  birthDeletionOutcomes,
  operationFailureWords,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useContext, useEffect } from "react";
import { toastManager } from "~/lib/toasts";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useAccountDataOptional, useProjection } from "~/zerops/ZeropsAccountData";

const EMPTY = Atom.make([] as ReturnType<typeof birthDeletionOutcomes.derive>);

/** HQ keeps each result until its maker has seen its warning and acknowledged it. */
export function BirthDeletionOutcomes() {
  const data = useAccountDataOptional();
  const orgId = data?.orgId ?? null;
  const outcomes = useProjection(birthDeletionOutcomes, orgId, EMPTY);
  const operations = useAccountOperations();
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (data === null || orgId === null) return;
    for (const outcome of outcomes) {
      // Another render may have submitted the acknowledgement since this render read its list.
      if (
        !registry
          .get(data.data.project(birthDeletionOutcomes, orgId))
          .some((item) => item.id === outcome.id)
      )
        continue;
      const requestId = birthDeletionAcknowledgementId(orgId, outcome.id);
      const failure = outcome.operation.failure;
      const settlement =
        failure !== undefined &&
        outcome.outcome !== "done" &&
        outcome.outcome !== "unconfirmed_setup"
          ? { kind: "failed" as const, reason: operationFailureWords(failure) }
          : { kind: "succeeded" as const };
      if (outcome.outcome === "unconfirmed_setup") {
        const resources = outcome.unconfirmedSetup ?? [];
        const names = [
          ...(resources.includes("mate_key") ? ["Mate key"] : []),
          ...(resources.includes("zcp_service") ? ["zcp service"] : []),
        ];
        toastManager.add({
          id: requestId,
          type: "warning",
          title: "Check the setup in Zerops",
          description: `HQ could not confirm ${names.length > 0 ? `the ${names.join(" and ")}` : "all setup resources"}${outcome.projectId === undefined ? "" : ` in project ${outcome.projectId}`}.`,
          timeout: 0,
        });
      } else if (outcome.operation.failure !== undefined) {
        toastManager.add({
          id: requestId,
          type: "error",
          title: "Mate setup could not be deleted",
          description: operationFailureWords(outcome.operation.failure),
          timeout: 0,
        });
      }
      void operations
        .submit(
          { kind: "acknowledge-birth-deletion", orgId, id: outcome.id, settlement },
          requestId,
        )
        .then(({ progress }) => {
          if (progress.stage === "done" && progress.outcome === "succeeded") return;
          toastManager.add({
            type: "error",
            title: "HQ could not acknowledge the deletion result",
            description: "The result may be shown again when you return.",
          });
        })
        .catch(() => {
          toastManager.add({
            type: "error",
            title: "HQ could not acknowledge the deletion result",
            description: "The result may be shown again when you return.",
          });
        });
    }
  }, [data, operations, orgId, outcomes, registry]);
  return null;
}
