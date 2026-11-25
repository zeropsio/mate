import { useState } from "react";
import type { KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { useAccountOrgId } from "~/zerops/accountData";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { submitHqAppWrite } from "~/zerops/hqAppWrite";
import { Button } from "../ui/button";

/** Submit under the request identity and retry decision owned by the projection. */
export function useKeptCodeAnswer() {
  const orgId = useAccountOrgId();
  const operations = useAccountOperationsOptional();
  return orgId === null || operations === null
    ? undefined
    : (view: KeptGitQuestionView, answer: "keep" | "delete") =>
        submitHqAppWrite(
          operations,
          { kind: "answer-kept-git", orgId, appId: view.question.appId, answer },
          view.requestId,
        );
}

export function KeptCodeQuestion({
  view,
  answer,
}: {
  readonly view: KeptGitQuestionView;
  readonly answer?: ((answer: "keep" | "delete") => Promise<void>) | undefined;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = sending || view.pending;
  const message = view.pending ? view.message : (error ?? view.message);
  const send = async (choice: "keep" | "delete") => {
    if (busy || answer === undefined) return;
    const current = captureAccountLifetime();
    setSending(true);
    setError(null);
    try {
      await answer(choice);
      if (current()) setConfirmDelete(false);
    } catch (cause) {
      if (current())
        setError(cause instanceof Error ? cause.message : "HQ could not take your answer.");
    } finally {
      if (current()) setSending(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 text-body" data-zerops-surface="kept-code-question">
      <p>{view.question.projectName ?? view.question.appName} was removed. Keep its code?</p>
      <p className="text-muted-foreground">
        Kept code stays billed as storage until you delete it.
      </p>
      {confirmDelete ? (
        <>
          <p>
            Delete {view.question.appName} and its code? This permanently deletes its repositories.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || answer === undefined}
              onClick={() => void send("delete")}
            >
              Delete code
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || answer === undefined}
            onClick={() => void send("keep")}
          >
            Keep code
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || answer === undefined}
            onClick={() => setConfirmDelete(true)}
          >
            Delete code…
          </Button>
        </div>
      )}
      {message ? (
        <p role="status" className="text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
