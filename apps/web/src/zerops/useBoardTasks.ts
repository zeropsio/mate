/**
 * The Board's doors in the web client: what the person may do on an application's Board
 * (`boardOffers`), whether the application has a Board yet (`boardRevision`), **Take** — HQ's take,
 * then a new conversation in the person's own Mate whose first message is the task's brief, sent
 * as them and linked to the task (`ComposerSendIds.taken`) — and the way back to the conversation
 * a task was put from.
 */
import { boardOffers, boardRevision, type BoardOffers } from "@t3tools/client-runtime/data";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { findCandidate } from "@t3tools/client-runtime/zerops/projections";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { useRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { newCommandId, newMessageId } from "../lib/utils";
import { readThreadShell, useProjects } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useAccountOrgId, useProjection } from "./accountData";
import { useOpenMate } from "./useOpenMate";
import { useBoardTaskWrites } from "./useTaskSourceSettings";
import { useZeropsDetailCandidates } from "./useZeropsCandidates";

const NO_OFFERS = Atom.make<BoardOffers | undefined>(undefined);
const NO_REVISION = Atom.make<number | undefined>(undefined);

function useAppKey(appId: string | null) {
  const orgId = useAccountOrgId();
  return useMemo(
    () => (orgId === null || appId === null ? null : { orgId, appId }),
    [orgId, appId],
  );
}

/** What the person may do on application `appId`'s Board; `undefined` until Zerops is read. */
export function useBoardOffers(appId: string | null): BoardOffers | undefined {
  return useProjection(boardOffers, useAppKey(appId), NO_OFFERS);
}

/** The application's Board revision (`boardRevision`): above zero once its Board was written. */
export function useBoardRevision(appId: string | null): number | undefined {
  return useProjection(boardRevision, useAppKey(appId), NO_REVISION);
}

/**
 * Opens a new conversation in Mate `mateProjectId` and sends `brief` as its first message, carrying
 * the task it is (`taken`): in the Mate's environment where this page is linked to it, else once its
 * door has connected it (`useOpenMate`).
 */
function useOpenTakenConversation() {
  const { listing } = useZeropsDetailCandidates();
  const openMate = useOpenMate();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects();
  return useCallback(
    (mateProjectId: string, taken: NonNullable<ReturnType<typeof takenOf>>, brief: string) => {
      const startIn = (environmentId: EnvironmentId, projectId: ProjectId | undefined) => {
        if (projectId === undefined) return;
        void handleNewThread(scopeProjectRef(environmentId, projectId), { fresh: true }).then(
          (opened) => {
            if (opened === null) return;
            useComposerDraftStore.getState().requestSend(opened.draftId, brief, {
              commandId: newCommandId(),
              messageId: newMessageId(),
              taken,
            });
          },
        );
      };
      const lookup = findCandidate(listing, (row) => row.project.id === mateProjectId);
      const environmentId = lookup.kind === "found" ? lookup.row.environmentId : undefined;
      if (environmentId !== undefined)
        return startIn(
          environmentId,
          projects.find((entry) => entry.environmentId === environmentId)?.id,
        );
      // Its door connects it first: the conversation it opens names the project to start in.
      openMate(lookup.kind === "found" ? lookup.row : { projectId: mateProjectId }, (opened) => {
        startIn(opened.environmentId, readThreadShell(opened)?.projectId);
      });
    },
    [handleNewThread, listing, openMate, projects],
  );
}

/** The task as a taken conversation's first message carries it; `null` where HQ named no source. */
const takenOf = (task: HqAppTask) =>
  task.source === undefined ? null : { taskId: task.id, source: task.source };

/**
 * **Take**: HQ takes the task for the person's Mate `mateProjectId`, then its conversation opens
 * with the brief as the first message. HQ's refusal stands on the task's row (`appTaskWrites`).
 */
export function useTakeTask(appId: string | null) {
  const writes = useBoardTaskWrites(appId);
  const open = useOpenTakenConversation();
  return useCallback(
    async (taskId: string, mateProjectId: string) => {
      const task = await writes?.take(taskId, mateProjectId);
      if (task == null) return;
      const taken = takenOf(task);
      if (taken === null) return;
      open(mateProjectId, taken, task.brief ?? task.title);
    },
    [open, writes],
  );
}

/**
 * Opens the conversation a task was put from: where this page is linked to its Mate, that
 * conversation; else the Mate, through its door.
 */
export function useOpenTaskConversation() {
  const router = useRouter();
  const { listing } = useZeropsDetailCandidates();
  const openMate = useOpenMate();
  return useCallback(
    (conversation: { readonly mateProjectId: string; readonly conversationId: string }) => {
      const lookup = findCandidate(listing, (row) => row.project.id === conversation.mateProjectId);
      const environmentId = lookup.kind === "found" ? lookup.row.environmentId : undefined;
      if (environmentId === undefined) {
        openMate(lookup.kind === "found" ? lookup.row : { projectId: conversation.mateProjectId });
        return;
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(
          scopeThreadRef(environmentId, conversation.conversationId as ThreadId),
        ),
      });
    },
    [listing, openMate, router],
  );
}
