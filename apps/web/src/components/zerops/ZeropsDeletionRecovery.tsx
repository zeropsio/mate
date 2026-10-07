import { useState } from "react";
import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useAccountOperations } from "~/zerops/accountOperations";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useLifecycleRemainders } from "~/zerops/useLifecycleRemainders";
import { Button } from "../ui/button";

/** A reopened account finishes only the original deletion's HQ and exact-key cleanup. */
export function ZeropsDeletionRecovery() {
  const { deletions } = useLifecycleRemainders();
  const operations = useAccountOperations();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finish = async (record: HqLifecycleRecord) => {
    if (
      busy !== null ||
      record.intent.kind !== "prepare-mate-deletion" ||
      record.result === undefined
    )
      return;
    const isCurrent = captureAccountLifetime();
    const {
      requestId: preparedRequestId,
      intent: { orgId, hqProjectId, projectId },
      result: { completion, keyTokenId },
    } = record;
    setBusy(preparedRequestId);
    setError(null);
    try {
      await operations.run(
        {
          kind: "complete-mate-deletion",
          orgId,
          hqProjectId,
          projectId,
          preparedRequestId,
          completion,
        },
        {
          orgId,
          requestId: `${preparedRequestId}:complete`,
          unobserved: "HQ must confirm the original deletion.",
        },
      );
      if (!isCurrent()) return;
      if (keyTokenId !== null)
        await operations.run(
          {
            kind: "retire-mate-key",
            orgId,
            projectId,
            tokenId: keyTokenId,
            preparedRequestId,
            completionRequestId: `${preparedRequestId}:complete`,
          },
          {
            orgId,
            requestId: `${preparedRequestId}:retire`,
            unobserved: "Read the original key before trying cleanup again.",
          },
        );
      if (!isCurrent()) return;
      await operations.run(
        {
          kind: "complete-key-retirement",
          orgId,
          hqProjectId,
          projectId,
          preparedRequestId,
          completionRequestId: `${preparedRequestId}:complete`,
        },
        {
          orgId,
          requestId: `${preparedRequestId}:retired`,
          unobserved: "HQ must confirm the key cleanup.",
        },
      );
    } catch (cause) {
      if (isCurrent()) setError(zeropsErrorMessage(cause));
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };
  if (deletions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {deletions.map((record) => (
        <div key={record.requestId} className="flex items-center gap-2">
          <span>
            {record.projectName ?? "This Mate"} was deleted. Its cleanup still needs confirmation.
          </span>
          <Button
            variant="ghost"
            size="compact"
            disabled={busy !== null}
            onClick={() => void finish(record)}
          >
            {busy === record.requestId ? "Finishing deletion…" : "Finish deleting Mate"}
          </Button>
        </div>
      ))}
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  );
}
