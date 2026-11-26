import { useState, type ReactNode } from "react";
import type { KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { useAccountOrgId } from "~/zerops/accountData";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { submitHqAppWrite } from "~/zerops/hqAppWrite";
import { Button } from "../ui/button";
import { Failure } from "../ui/failure";
import { Text } from "../ui/text";

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
  children,
}: {
  readonly view: KeptGitQuestionView;
  readonly answer?: ((answer: "keep" | "delete") => Promise<void>) | undefined;
  readonly children: (slots: {
    readonly presses: ReactNode;
    readonly lines: ReactNode;
  }) => ReactNode;
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
  const presses = confirmDelete ? null : (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || answer === undefined} onClick={() => void send("keep")}>
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
  );
  const lines = (
    <div className="flex flex-col gap-2" data-zerops-surface="kept-code-question">
      <Text variant="heading">
        {view.question.projectName ?? view.question.appName} was removed. Keep its code?
      </Text>
      <Text variant="description">Kept code stays billed as storage until you delete it.</Text>
      {confirmDelete ? (
        <>
          <Text variant="description">
            Delete {view.question.appName} and its code? This permanently deletes its repositories.
          </Text>
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
      ) : null}
      {message ? <Failure size="line" cause={message} /> : null}
    </div>
  );
  return children({ presses, lines });
}
