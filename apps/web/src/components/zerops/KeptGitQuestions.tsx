import { useState } from "react";
import { Atom } from "effect/reactivity";
import { hqKeptGitQuestions, type KeptGitQuestionView } from "@t3tools/client-runtime/data";
import { useAccountOrgId, useProjection } from "~/zerops/accountData";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { submitHqAppWrite } from "~/zerops/hqAppWrite";
import { Button } from "../ui/button";

const NO_QUESTIONS = Atom.make<ReadonlyArray<KeptGitQuestionView>>([]);

/** Navigation only shows questions HQ admits to this reader. */
export function KeptGitQuestions() {
  const orgId = useAccountOrgId();
  const questions = useProjection(hqKeptGitQuestions, orgId, NO_QUESTIONS);
  const operations = useAccountOperationsOptional();
  if (orgId === null || questions.length === 0) return null;
  return (
    <section aria-label="Kept Git of a removed project" className="flex flex-col gap-3 px-4 py-3">
      <h2 className="text-caption text-muted-foreground">Kept Git of a removed project</h2>
      {questions.map((view) => (
        <KeptGitQuestion
          key={`${view.question.appId}:${view.question.askedAt}`}
          view={view}
          answer={
            operations === null
              ? undefined
              : (answer) =>
                  submitHqAppWrite(
                    operations,
                    {
                      kind: "answer-kept-git",
                      orgId,
                      appId: view.question.appId,
                      answer,
                    },
                    view.requestId,
                  )
          }
        />
      ))}
    </section>
  );
}

export function KeptGitQuestion({
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
    <div
      className="flex flex-col gap-2 rounded-card border border-border bg-card p-3 text-body"
      data-zerops-surface="kept-git-question"
    >
      <p className="font-medium">{view.question.appName}</p>
      <p className="text-muted-foreground">
        {view.question.projectName ?? view.question.appName} was removed. Keep its Git?
      </p>
      <p className="text-muted-foreground">
        Its Git stays kept and billed as storage until you delete it.
      </p>
      {confirmDelete ? (
        <>
          <p>
            Delete {view.question.appName} and its Git? This permanently deletes its repositories.
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
              Delete Git
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
            Keep Git
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || answer === undefined}
            onClick={() => setConfirmDelete(true)}
          >
            Delete Git…
          </Button>
        </div>
      )}
      {(error ?? view.message) ? (
        <p role="status" className="text-muted-foreground">
          {error ?? view.message}
        </p>
      ) : null}
    </div>
  );
}
