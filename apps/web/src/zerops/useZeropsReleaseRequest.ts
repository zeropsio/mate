/**
 * A person's yes to the release question, sent into the bound conversation: one visible message
 * asking its agent to release the lease (`zeropsReleaseTurn`), after bringing an archived
 * conversation back (`sendZeropsReleaseRequest`). Mate releases nothing and runs no zcp: the
 * agent's own `zerops_lease action=release` and the unbind fan-out do the rest (zcp
 * `docs/spec-mate.md` §6.3). A send that fails says so; nothing sends it again by itself.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  sendZeropsReleaseRequest,
  zeropsReleaseTurn,
  type ZeropsReleaseConversation,
} from "@t3tools/client-runtime/zerops";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { newCommandId, newMessageId } from "../lib/utils";
import { threadEnvironment } from "../state/threads";
import { useMateCommand } from "./accountEnvironments";

export type ZeropsReleaseRequest = (input: {
  readonly threadRef: ScopedThreadRef;
  /** The bound conversation, as its turn is sent. */
  readonly conversation: ZeropsReleaseConversation;
  readonly alias: string;
  /** False for another of the Mate's workspaces, which the conversation is not bound to. */
  readonly bound?: boolean | undefined;
  /** Archived: brought back (`unarchive`) before the request is sent. */
  readonly archived: boolean;
  readonly unarchive: () => Promise<AtomCommandResult<unknown, unknown>>;
}) => Promise<AtomCommandResult<unknown, unknown>>;

export function useZeropsReleaseRequest(): ZeropsReleaseRequest {
  const startTurn = useMateCommand(threadEnvironment.startTurn, { reportFailure: false });
  return useCallback<ZeropsReleaseRequest>(
    async (input) => {
      const result = await sendZeropsReleaseRequest({
        turn: zeropsReleaseTurn({
          conversation: input.conversation,
          alias: input.alias,
          bound: input.bound,
          ids: { commandId: newCommandId(), messageId: newMessageId() },
          createdAt: new Date().toISOString(),
        }),
        archived: input.archived,
        unarchive: input.unarchive,
        startTurn: (turn) =>
          startTurn({ environmentId: input.threadRef.environmentId, input: turn }),
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not ask for the release",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return result;
    },
    [startTurn],
  );
}
