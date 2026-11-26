/**
 * A person's access change as HQ runs it (`accessOperations`), on their team card and their page:
 * running, its step in words; waiting for the viewer's fresh sign-in, *Continue* and *Delete*;
 * waiting for another maker, an Owner's or Admin's *End*; failed, the kit's failure line: what
 * stopped, why, *Delete*, and Zerops' answer under Details. A Send again that failed after
 * withdrawing the invitation says the invitation was lost, by its address where the team still
 * names it. HQ ending the change takes the row away.
 */
import {
  accessOperationWithdrawal,
  PRESSING,
  type AccessOperationRow as Row,
} from "@t3tools/client-runtime/data";
import { useState } from "react";

import { InlineButton } from "../ui/button";
import { ZeropsOperationEnd } from "../zerops/ZeropsOperationEnd";
import { Failure } from "../ui/failure";
import { Loading } from "../ui/loading";

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "HQ didn't take it.";

/** What a stopped change says first: what it was doing, or the invitation a Send again lost. */
function stoppedLead(operation: Row, address: string | null): string {
  if (operation.invitationLost === true)
    return `The invitation${address === null ? "" : ` to ${address}`} was withdrawn, but Zerops didn't send it again.`;
  return `${operation.phase} stopped.`;
}

export function AccessOperationRow({
  operation,
  address = null,
  onContinue,
  onDelete,
}: {
  readonly operation: Row;
  /** The changed person's address, where the team still lists them. */
  readonly address?: string | null;
  /** Absent: the row offers no press. */
  readonly onContinue?: (id: string) => Promise<void>;
  readonly onDelete?: (id: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<"continue" | "delete" | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const press = (which: "continue" | "delete") => {
    const run = which === "continue" ? onContinue : onDelete;
    if (run === undefined) return;
    setPending(which);
    setTrouble(null);
    run(operation.id)
      .catch((cause: unknown) => setTrouble(messageOf(cause)))
      .finally(() => setPending(null));
  };

  if (operation.state === "running")
    return <Loading data-part="access-operation" label={operation.phase} shape="words" />;
  const withdrawal = onDelete === undefined ? null : accessOperationWithdrawal(operation);
  const presses = (
    <>
      {operation.state === "waiting" && operation.mine && onContinue !== undefined ? (
        <InlineButton
          aria-busy={pending === "continue" || undefined}
          disabled={pending !== null}
          onClick={() => press("continue")}
        >
          {pending === "continue"
            ? PRESSING[operation.press ?? "Continue"]
            : (operation.press ?? "Continue")}
        </InlineButton>
      ) : null}
      {withdrawal === "end" ? (
        <ZeropsOperationEnd
          disabled={pending !== null}
          kind="access"
          name={address ?? "this person"}
          onEnd={() => press("delete")}
        />
      ) : null}
      {withdrawal === "delete" ? (
        <InlineButton
          aria-busy={pending === "delete" || undefined}
          disabled={pending !== null}
          onClick={() => press("delete")}
          tone="destructive"
        >
          {pending === "delete" ? "Deleting…" : "Delete"}
        </InlineButton>
      ) : null}
    </>
  );
  const pressed = trouble === null ? null : <Failure cause={trouble} size="line" />;
  if (operation.state === "failed")
    // What stopped, why in the source's words, the one press, Zerops' whole answer folded.
    return (
      <span className="flex flex-col gap-1" data-part="access-operation" data-state="failed">
        <Failure
          action={withdrawal === null ? undefined : presses}
          cause={stoppedLead(operation, address)}
          details={operation.details ?? undefined}
          role="alert"
          size="line"
        >
          {operation.failure}
        </Failure>
        {pressed}
      </span>
    );
  const said = operation.mine
    ? `${stoppedLead(operation, address)} ${operation.failure ?? ""}`.trim()
    : `${operation.failure} It waits for the person who started it.`;
  // Waiting: what it waits on, then its presses on their own line, as a failure's are.
  return (
    <span className="flex flex-col gap-1" data-part="access-operation" data-state="waiting">
      <span role="alert">{said}</span>
      <span className="block space-x-3">{presses}</span>
      {pressed}
    </span>
  );
}
