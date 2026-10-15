/**
 * A stop's services HQ stopped because the tier no longer declares them (`stopTierStops`): why each
 * stands, and *Delete* where the tier itself dropped it. Deleting is irreversible and a person's
 * act alone, so it asks first.
 */
import type { StopTierStop } from "@t3tools/client-runtime/zerops/flow";
import { useState } from "react";

import { useDeleteService } from "../../zerops/deleteService";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

export function StopTierStops({
  projectId,
  rows,
  rowClassName,
}: {
  readonly projectId: string;
  readonly rows: ReadonlyArray<StopTierStop>;
  readonly rowClassName: string;
}) {
  const deleteService = useDeleteService();
  const [asking, setAsking] = useState<StopTierStop | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<{ readonly hostname: string; readonly text: string }>();
  if (rows.length === 0) return null;
  const confirm = (row: StopTierStop) => {
    setAsking(null);
    if (row.deletable === undefined) return;
    setDeleting(row.hostname);
    setTrouble(undefined);
    deleteService(projectId, row.deletable.serviceId).then(
      () => setDeleting(null),
      (cause: unknown) => {
        setDeleting(null);
        setTrouble({
          hostname: row.hostname,
          text: cause instanceof Error ? cause.message : "Zerops did not delete it.",
        });
      },
    );
  };
  return (
    <>
      <ul className="flex flex-col" data-zerops-surface="stop-tier-stops">
        {rows.map((row) => (
          <li className={rowClassName} data-zerops-tier-stop={row.hostname} key={row.hostname}>
            <span className="flex min-w-0 flex-col">
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                {row.hostname} · {row.line}
              </span>
              {trouble?.hostname === row.hostname ? (
                <span className="text-xs text-status-failed-text">{trouble.text}</span>
              ) : null}
            </span>
            {row.deletable === undefined ? (
              <span />
            ) : (
              <Button
                disabled={deleting !== null}
                onClick={() => setAsking(row)}
                size="compact"
                variant="outline"
              >
                {deleting === row.hostname ? "Deleting…" : "Delete"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        open={asking !== null}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {asking?.hostname}?</AlertDialogTitle>
            <AlertDialogDescription>
              Zerops deletes {asking?.hostname} and everything it holds. You can’t undo this. Its
              tier no longer declares it; only a change that declares it again brings a new one
              back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                if (asking !== null) confirm(asking);
              }}
              variant="destructive"
            >
              Delete {asking?.hostname}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
