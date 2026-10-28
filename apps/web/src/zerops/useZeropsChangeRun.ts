/**
 * The run that made a change, found in its Mate's conversation (pass 16, R3): the review's way back
 * to it. Its words are never quoted: a reply may be about other changes too.
 *
 * A Mate writes its change's address at HQ into its answer (`changeLinks.ts`), so the run that
 * made it is the Mate's newest answer that links it at the organization's official HQ. Its main
 * conversation is read while the review is open: often already held, since the person was just in
 * it. A Mate that is not connected, or never linked the change, has no run to go back to.
 */
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { changeRunMessage } from "../components/zerops/review/ZeropsReview.logic";
import { useThreadMessages, useThreadShells } from "../state/entities";
import { useHqAddress } from "./projectFlows";
import { askMateThread } from "./useAskMate";
import { useZeropsDetailCandidates } from "./useZeropsCandidates";

export interface ZeropsChangeRun {
  /** Where "The run that made it" goes: only where one of its answers links the change. */
  readonly threadRef: ScopedThreadRef | undefined;
}

const NO_RUN: ZeropsChangeRun = { threadRef: undefined };

export function useZeropsChangeRun(
  change: {
    readonly mateProjectId: string;
    /** Its application, which is its group. */
    readonly appId: string;
    readonly repository: string;
    readonly number: number;
  } | null,
): ZeropsChangeRun {
  const hqAddress = useHqAddress();
  const { listing } = useZeropsDetailCandidates();
  const shells = useThreadShells();
  const mateProjectId = change?.mateProjectId;
  const environmentId = useMemo(
    () =>
      mateProjectId === undefined
        ? undefined
        : heldCandidates(listing).rows.find((row) => row.project.id === mateProjectId)
            ?.environmentId,
    [listing, mateProjectId],
  );
  const threadRef = useMemo(() => {
    if (environmentId === undefined) return undefined;
    const chat = askMateThread(
      shells.filter((shell) => shell.environmentId === environmentId),
      undefined,
    );
    return chat === undefined ? undefined : scopeThreadRef(environmentId, chat.id);
  }, [environmentId, shells]);
  const messages = useThreadMessages(threadRef ?? null);
  if (threadRef === undefined || change === null || hqAddress === undefined) return NO_RUN;
  const linked = changeRunMessage(
    messages,
    { appId: change.appId, repo: change.repository, number: change.number },
    hqAddress,
  );
  // A conversation where no answer links it has no run that made it to go back to.
  return linked === undefined ? NO_RUN : { threadRef };
}
