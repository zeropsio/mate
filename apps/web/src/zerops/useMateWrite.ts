/**
 * Writing to a Mate from outside its conversation — the jump box, the menu's Waiting on you list —
 * with what a send from its own composer carries: the conversation's own model and modes, and what
 * the Mate has not been told of the changes that landed since it last spoke (`agentTurnNotes`),
 * and of the vault (`useVaultTurnNotes`).
 *
 * Its conversation is read while a surface holds it — what it asks, its plan, what it last said —
 * and the Mate is held connected meanwhile (`useMateHeld`): a parked one connects for the read and
 * the send, and parks again once the surface lets it go. Nothing is sent before the read: a send
 * asked earlier answers `undefined`, and the surface waits for `detail`.
 */
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { agentLastSpokeAt, agentNotesFor, agentTurnNotes } from "@t3tools/client-runtime/zerops";
import {
  ApprovalRequestId,
  type EnvironmentId,
  type ProviderApprovalDecision,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useMemo } from "react";

import { newMessageId } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";
import { threadEnvironment, useEnvironmentThread } from "~/state/threads";

import { useMateCommand, useMateHeld } from "./accountEnvironments";
import { useZeropsChangeLandedEvents } from "./useZeropsChangeLandedEvents";
import { useVaultTurnNotes } from "./vaultTurnNotes";

export function useMateWrite(environmentId: EnvironmentId | null, threadId: ThreadId | null) {
  const shells = useThreadShells();
  const shell = shells.find(
    (entry) => entry.environmentId === environmentId && entry.id === threadId,
  );
  useMateHeld(environmentId);
  const thread = useEnvironmentThread(environmentId, threadId);
  const detail = Option.getOrUndefined(thread.data);
  const requests = useMemo(
    () => derivePendingRequests(detail?.activities ?? []),
    [detail?.activities],
  );
  const landed = useZeropsChangeLandedEvents(environmentId);
  // The vault changes the Mate has not heard, the same note its own composer would carry.
  const vaultTurn = useVaultTurnNotes(
    environmentId,
    environmentId === null || threadId === null
      ? null
      : scopedThreadKey(scopeThreadRef(environmentId, threadId)),
    useMemo(() => (detail === undefined ? undefined : agentLastSpokeAt(detail.messages)), [detail]),
  );
  // A parked Mate's cached conversation reads before its link is up: the send waits for it.
  const startTurn = useMateCommand(threadEnvironment.startTurn, { reportFailure: false });
  const respondToUserInput = useMateCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const respondToApproval = useMateCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });

  /** Sends words as a turn, in the conversation's own mode unless one is named (a plan's). */
  const send = (text: string, interactionMode?: "default" | "plan") => {
    if (environmentId === null || threadId === null || detail === undefined || shell === undefined)
      return undefined;
    // When the agent last spoke: the line between what it knows and what landed since — the
    // conversation's own reading of it. A slash command carries none.
    const notes = agentNotesFor(text, [
      ...agentTurnNotes(landed, agentLastSpokeAt(detail.messages)),
      ...(vaultTurn.note === null ? [] : [vaultTurn.note]),
    ]);
    const toldVault =
      vaultTurn.note !== null && notes.includes(vaultTurn.note) ? vaultTurn.changes : [];
    return startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        modelSelection: shell.modelSelection,
        ...(notes.length > 0 ? { agentNotes: notes } : {}),
        runtimeMode: shell.runtimeMode,
        interactionMode: interactionMode ?? shell.interactionMode,
        createdAt: new Date().toISOString(),
      },
    }).then((result) => {
      if (result._tag === "Success") vaultTurn.told(toldVault);
      return result;
    });
  };

  /** Answers the question it asks (`thread.user-input.respond`), as the composer does. */
  const answer = (requestId: string, questionId: string, text: string) => {
    if (environmentId === null || threadId === null) return undefined;
    return respondToUserInput({
      environmentId,
      input: {
        threadId,
        requestId: ApprovalRequestId.make(requestId),
        answers: { [questionId]: text },
      },
    });
  };

  /** Decides what it asks to be allowed, as the conversation's approval does. */
  const decide = (requestId: string, decision: ProviderApprovalDecision) => {
    if (environmentId === null || threadId === null) return undefined;
    return respondToApproval({
      environmentId,
      input: { threadId, requestId: ApprovalRequestId.make(requestId), decision },
    });
  };

  return { shell, detail, requests, send, answer, decide };
}
