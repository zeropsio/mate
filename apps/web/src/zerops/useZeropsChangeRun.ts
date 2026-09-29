/**
 * The run that made a change, found in its Mate's conversation (pass 16, R3): the review starts
 * from what the change is for, in the Mate's own words, with the way back to that run.
 *
 * A Mate writes the pull request's address into its answer — "Pull request carrying this to
 * main, ready for a person to merge: https://…/links/appdev/pulls/5" (`giteaChangeLink.ts`) — so
 * the run that made it is the Mate's newest answer that links it. Its main conversation is read
 * while the review is open: often already held, since the person was just in it. A Mate that is
 * not connected, or never linked the change, has no run to quote, and the review says nothing
 * rather than guessing.
 */
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { changeRunMessage, runWords } from "../components/zerops/review/ZeropsReview.logic";
import { useThreadMessages, useThreadShells, useThreadStatus } from "../state/entities";
import { askMateThread } from "./useAskMate";
import { useZeropsCandidates } from "./useZeropsCandidates";

export interface ZeropsChangeRun {
  /** What it does, in the Mate's words; `undefined` while reading and where none linked it. */
  readonly words: string | undefined;
  /** The Mate's conversation is still being read. */
  readonly reading: boolean;
  /** Where "The run that made it" goes. */
  readonly threadRef: ScopedThreadRef | undefined;
}

const NO_RUN: ZeropsChangeRun = { words: undefined, reading: false, threadRef: undefined };

export function useZeropsChangeRun(
  change: {
    readonly mateProjectId: string | undefined;
    readonly owner: string | undefined;
    readonly repository: string;
    readonly number: number;
  } | null,
): ZeropsChangeRun {
  const { listing } = useZeropsCandidates();
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
  const status = useThreadStatus(threadRef ?? null);
  const path =
    change === null || change.owner === undefined
      ? undefined
      : `/${change.owner}/${change.repository}/pulls/${String(change.number)}`;
  if (threadRef === undefined || path === undefined) return NO_RUN;
  const linked = changeRunMessage(messages, path);
  if (linked !== undefined)
    return { words: runWords(linked.text, path), reading: false, threadRef };
  return { words: undefined, reading: status === "empty" || status === "synchronizing", threadRef };
}
