/**
 * The Board's doors in the web client: what the person may do on an application's Board
 * (`boardOffers`), **Take** — HQ's take,
 * then a new conversation in the person's own Mate whose first message is the task's brief, sent
 * as them and linked to the task (`ComposerSendIds.taken`), where it stands until it went
 * (`TakeOpening`) — and the ways back to the conversation a task was put from.
 */
import {
  boardOffers,
  putChatOf,
  readsOfState,
  type BoardOffers,
} from "@t3tools/client-runtime/data";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  assignCandidateMateTints,
  mateShapeOf,
  projectNameInApp,
} from "@t3tools/client-runtime/zerops";
import { findCandidate, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { useRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { REQUESTED_SEND_WAIT_MS, sendOutcomeOf } from "../hooks/useComposerSendRequests";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { newCommandId, newMessageId } from "../lib/utils";
import { readThreadShell, useProjects } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { hqPlacementsAtom } from "../state/zerops";
import { useAccountOrgId, useAccountStoreForAdapters, useProjection } from "./accountData";
import { useOpenMate } from "./useOpenMate";
import { useBoardTaskWrites } from "./useTaskSourceSettings";
import { useZeropsCandidates, useZeropsDetailCandidates } from "./useZeropsCandidates";

const NO_OFFERS = Atom.make<BoardOffers | undefined>(undefined);

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

/**
 * Where a Take's conversation stands after HQ took the task, by the task: opening, or stranded — HQ
 * took it but its conversation did not open or its brief did not go, in words — so its row offers
 * to open it again under the same task. Kept for the tab's life: the Board read again, or left and
 * come back to, still says it. Opened, it is forgotten.
 */
export type TakeOpening =
  | { readonly kind: "opening" }
  | { readonly kind: "stranded"; readonly words: string };

let openings: Readonly<Record<string, TakeOpening>> = {};
const listeners = new Set<() => void>();
function setOpening(taskId: string, opening: TakeOpening | null): void {
  const { [taskId]: _was, ...rest } = openings;
  openings = opening === null ? rest : { ...rest, [taskId]: opening };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Where each Take's conversation stands, by task (`TakeOpening`). */
export function useTakeOpenings(): Readonly<Record<string, TakeOpening>> {
  return useSyncExternalStore(subscribe, () => openings);
}

/** How long a Mate's door may take to open a conversation before the Take says it did not. */
const OPEN_WAIT_MS = REQUESTED_SEND_WAIT_MS;

/**
 * Opens a new conversation in Mate `mateProjectId` and sends `brief` as its first message, carrying
 * the task it is (`taken`): in the Mate's environment where this page is linked to it, else once its
 * door has connected it (`useOpenMate`), within a bounded wait. Answers why it did not, or `null`
 * once its first message went.
 */
function useOpenTakenConversation() {
  const { listing } = useZeropsDetailCandidates();
  const openMate = useOpenMate();
  const handleNewThread = useNewThreadHandler();
  const projects = useProjects();
  return useCallback(
    async (
      mateProjectId: string,
      taken: NonNullable<ReturnType<typeof takenOf>>,
      brief: string,
    ): Promise<string | null> => {
      const lookup = findCandidate(listing, (row) => row.project.id === mateProjectId);
      const linked = lookup.kind === "found" ? lookup.row.environmentId : undefined;
      const where =
        linked !== undefined
          ? {
              environmentId: linked,
              projectId: projects.find((entry) => entry.environmentId === linked)?.id,
            }
          : // Its door connects it first: the conversation it opens names the project to start in.
            await new Promise<{
              environmentId: EnvironmentId;
              projectId: ProjectId | undefined;
            } | null>((resolve) => {
              const timer = setTimeout(() => resolve(null), OPEN_WAIT_MS);
              const kind = openMate(
                lookup.kind === "found" ? lookup.row : { projectId: mateProjectId },
                (opened) => {
                  clearTimeout(timer);
                  resolve({
                    environmentId: opened.environmentId,
                    projectId: readThreadShell(opened)?.projectId,
                  });
                },
              );
              if (kind === "going") {
                clearTimeout(timer);
                resolve(null);
              }
            });
      if (where === null) return "Its Mate did not open in time.";
      if (where.projectId === undefined) return "Its Mate's workspace is not read yet.";
      const opened = await handleNewThread(scopeProjectRef(where.environmentId, where.projectId), {
        fresh: true,
      });
      if (opened === null) return "Its new conversation did not open.";
      const messageId = newMessageId();
      const outcome = sendOutcomeOf(messageId);
      useComposerDraftStore
        .getState()
        .requestSend(opened.draftId, brief, { commandId: newCommandId(), messageId, taken });
      const sent = await outcome;
      return sent.kind === "sent"
        ? null
        : sent.kind === "waits"
          ? `Its brief did not go: ${sent.why}`
          : "Its brief was changed before it went.";
    },
    [handleNewThread, listing, openMate, projects],
  );
}

/** The task as a taken conversation's first message carries it; `null` where HQ named no source. */
const takenOf = (task: HqAppTask) =>
  task.source === undefined ? null : { taskId: task.id, source: task.source };

/**
 * **Take**: HQ takes the task for the person's Mate `mateProjectId`, then its conversation opens
 * with the brief as the first message (`TakeOpening` meanwhile). HQ's refusal stands on the task's
 * row (`appTaskWrites`); a conversation that did not open strands the task taken, and **Open its
 * conversation** (`open`) tries again under the same task, never taking it twice.
 */
export function useTakeTask(appId: string | null) {
  const writes = useBoardTaskWrites(appId);
  const openTaken = useOpenTakenConversation();
  const open = useCallback(
    async (task: HqAppTask, mateProjectId: string) => {
      const taken = takenOf(task);
      if (taken === null) {
        setOpening(task.id, { kind: "stranded", words: "HQ did not say where it came from." });
        return;
      }
      setOpening(task.id, { kind: "opening" });
      const why = await openTaken(mateProjectId, taken, task.brief ?? task.title).catch(
        () => "Its conversation did not open.",
      );
      setOpening(task.id, why === null ? null : { kind: "stranded", words: why });
    },
    [openTaken],
  );
  const take = useCallback(
    async (taskId: string, mateProjectId: string) => {
      const task = await writes?.take(taskId, mateProjectId);
      if (task == null) return;
      await open(task, mateProjectId);
    },
    [open, writes],
  );
  return { take, open };
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

/** A Mate's face as the Board draws it: its name, colour and shape. */
export interface BoardFace {
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId | undefined;
}

/**
 * Each Mate the reader's list holds, by its project: its name and face — what the Board names a
 * person's Mate by, and whether a task's chat opens for them.
 */
export function useMateFaces(): ReadonlyMap<string, BoardFace> {
  const { listing } = useZeropsCandidates();
  const rows = useMemo(() => heldCandidates(listing).rows, [listing]);
  return useMemo(() => {
    const tints = assignCandidateMateTints(rows);
    return new Map(
      rows.map((candidate) => {
        const tint = tints.get(candidate.project.id) ?? "slate";
        return [
          candidate.project.id,
          {
            name: projectNameInApp(candidate.project),
            tint,
            shape: mateShapeOf(candidate.project, tint),
          },
        ] as const;
      }),
    );
  }, [rows]);
}

/**
 * Where the person who put a task on the Board answers its question: their own card in the chat they
 * put it from, where the Board read says which; else the application's Board, on its page.
 */
export function useAnswerPutTask() {
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const placements = useAtomValue(hqPlacementsAtom);
  const openConversation = useOpenTaskConversation();
  const router = useRouter();
  return useCallback(
    (task: { readonly projectId: string; readonly taskId: string }) => {
      const appId = placements?.get(task.projectId)?.appId ?? null;
      if (appId === null || orgId === null) return;
      const chat =
        store === null
          ? null
          : putChatOf(readsOfState(store.state()), { orgId, appId }, task.taskId);
      if (chat !== null) return openConversation(chat);
      void router.navigate({
        to: "/group/$groupId/flow",
        params: { groupId: appId },
        hash: "automation",
      });
    },
    [openConversation, orgId, placements, router, store],
  );
}
