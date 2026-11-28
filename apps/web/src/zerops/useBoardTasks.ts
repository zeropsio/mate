/**
 * The Board's doors in the web client: what the person may do on an application's Board
 * (`boardOffers`), **Take** — HQ's take,
 * then a new conversation in the person's own Mate whose first message is the task's brief, sent
 * as them and linked to the task (`ComposerSendIds.taken`); a taken task none of the Mate's conversations
 * carries (`strandedTakesAtom`), with its way to open it; and the ways back to the conversation a
 * task was put from.
 */
import {
  boardOffers,
  hqMateOverviewAtom,
  mateTakenTasksAtom,
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
  strandedTakes,
} from "@t3tools/client-runtime/zerops";
import { findCandidate, heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { EnvironmentId, type ThreadId } from "@t3tools/contracts";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { useRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { REQUESTED_SEND_WAIT_MS, sendOutcomeOf } from "../hooks/useComposerSendRequests";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { newCommandId, newMessageId } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentProjects } from "../state/projects";
import { environmentServerConfigsAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { hqPlacementsAtom } from "../state/zerops";
import { buildThreadRouteParams } from "../threadRoutes";
import { useAccountOrgId, useAccountStoreForAdapters, useProjection } from "./accountData";
import { useOpenMate } from "./useOpenMate";
import { useAppTaskSource, useBoardTaskWrites } from "./useTaskSourceSettings";
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
 * The Takes whose conversation this tab is opening, by task: the press under way, said on its row
 * and in its Mate's conversation, so neither offers to open it a second time meanwhile. The tab's
 * own and never kept: whether a taken task's conversation opened is the data's (`strandedTakesAtom`).
 */
let openings: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
function setOpening(taskId: string, on: boolean): void {
  const next = new Set(openings);
  if (on) next.add(taskId);
  else next.delete(taskId);
  openings = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The Takes this tab is opening a conversation for, by task. */
export function useTakeOpenings(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => openings);
}

/** A task the reader took for one of their Mates that none of that Mate's conversations carries. */
export interface StrandedTake {
  readonly taskId: string;
  readonly title: string;
  readonly mateProjectId: string;
  readonly environmentId: EnvironmentId;
  /** The application whose Board it is on: its record (the brief, its source) is read there. */
  readonly appId: string;
}

const NO_STRANDED: ReadonlyArray<StrandedTake> = [];
const strandedKey = (takes: ReadonlyArray<StrandedTake>) =>
  takes.map((take) => `${take.taskId}\n${take.environmentId}\n${take.title}`).join("\n");

/**
 * Every task the reader's Mates hold taken (HQ's navigation, `taken`) that none of the Mate's
 * conversations carries, as `strandedTakes` decides it over the Mate's rows this page's own socket
 * holds: the Board row and the Mate's conversation offer **Open its conversation** from it, on
 * every tab and device, a reload included.
 */
export const strandedTakesAtom = Atom.make((get): ReadonlyArray<StrandedTake> => {
  const placements = get(hqPlacementsAtom);
  if (placements === null) return NO_STRANDED;
  const stranded: StrandedTake[] = [];
  for (const [projectId, placement] of placements) {
    const taken = placement.mate?.taken;
    const appId = placement.appId;
    if (taken === undefined || taken.length === 0 || appId == null) continue;
    const at = get(hqMateOverviewAtom(projectId))?.identity?.environmentId;
    if (at === undefined) continue;
    const environmentId = EnvironmentId.make(at);
    const conversations = {
      listed: get(environmentShell.threadsListedAtom(environmentId)),
      namesTaken:
        get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
          .conversationTakenTask === true,
      carried: get(mateTakenTasksAtom(environmentId)),
    };
    for (const task of strandedTakes(taken, conversations))
      stranded.push({
        taskId: task.id,
        title: task.title,
        mateProjectId: projectId,
        environmentId,
        appId,
      });
  }
  return stranded.length === 0 ? NO_STRANDED : stranded;
}).pipe(
  Atom.withEquality(
    (a: ReadonlyArray<StrandedTake>, b: ReadonlyArray<StrandedTake>) =>
      strandedKey(a) === strandedKey(b),
  ),
  Atom.withLabel("zerops:stranded-takes"),
);

/** How long a Take may take to open its conversation before it is left stranded (`strandedTakes`). */
const OPEN_WAIT_MS = REQUESTED_SEND_WAIT_MS;

/**
 * The first answer `pick` finds in `atom` as it is read, or `null` once `deadline` passes: a wait on
 * the read itself (a subscription), never a sleep or a poll.
 */
function untilRead<A, B>(
  atom: Atom.Atom<A>,
  pick: (value: A) => B | undefined,
  deadline: number,
): Promise<B | null> {
  return new Promise((resolve) => {
    let settled = false;
    let release: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (value: B | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release?.();
      resolve(value);
    };
    timer = setTimeout(() => settle(null), Math.max(0, deadline - Date.now()));
    release = appAtomRegistry.subscribe(
      atom,
      (value) => {
        const found = pick(value);
        if (found !== undefined) settle(found);
      },
      { immediate: true },
    );
    // `immediate` may settle inside `subscribe`, before `release` exists.
    if (settled) release();
  });
}

type NewThread = ReturnType<typeof useNewThreadHandler>;

/** The task as a taken conversation's first message carries it; `null` where HQ named no source. */
const takenOf = (task: HqAppTask) =>
  task.source === undefined ? null : { taskId: task.id, source: task.source };

/**
 * Opens a new conversation for taken task `task` in its Mate's environment, once `reach` has it
 * (where this page is linked to the Mate, at once; else through its door), and sends its brief as
 * the first message, carrying the task (`taken`). Each step waits on its read within one bound: the
 * environment's project known, the brief taken by its conversation, then a row of the Mate's that
 * carries the task, so the press ends only once the data says the conversation opened. Where any
 * step does not come, the task is left stranded, and the Mate's conversations and the Board say so
 * from the data (`strandedTakesAtom`); one press at a time per task.
 */
async function openTaken(
  task: HqAppTask,
  reach: (deadline: number) => Promise<EnvironmentId | null>,
  handleNewThread: NewThread,
): Promise<void> {
  const taken = takenOf(task);
  if (taken === null || openings.has(task.id)) return;
  setOpening(task.id, true);
  try {
    const deadline = Date.now() + OPEN_WAIT_MS;
    const environmentId = await reach(deadline);
    if (environmentId === null) return;
    const projectId = await untilRead(
      environmentProjects.projectsAtom,
      (projects) => projects.find((entry) => entry.environmentId === environmentId)?.id,
      deadline,
    );
    if (projectId === null) return;
    const opened = await handleNewThread(scopeProjectRef(environmentId, projectId), {
      fresh: true,
    });
    if (opened === null) return;
    const messageId = newMessageId();
    const outcome = sendOutcomeOf(messageId);
    useComposerDraftStore.getState().requestSend(opened.draftId, task.brief ?? task.title, {
      commandId: newCommandId(),
      messageId,
      taken,
    });
    if ((await outcome).kind !== "sent") return;
    // Its row comes on the Mate's own stream after the send's answer: until then it is opening.
    await untilRead(
      mateTakenTasksAtom(environmentId),
      (carried) => (carried.includes(task.id) ? true : undefined),
      Date.now() + OPEN_WAIT_MS,
    );
  } finally {
    setOpening(task.id, false);
  }
}

/**
 * **Take**: HQ takes the task for the person's Mate `mateProjectId`, then its conversation opens
 * with the brief as the first message (`openTaken`). HQ's refusal stands on the task's row
 * (`appTaskWrites`); a conversation that did not open leaves the task stranded
 * (`strandedTakesAtom`), and **Open its conversation** (`open`) opens it under the same task,
 * never taking it twice.
 */
export function useTakeTask(appId: string | null) {
  const writes = useBoardTaskWrites(appId);
  const { listing } = useZeropsDetailCandidates();
  const openMate = useOpenMate();
  const handleNewThread = useNewThreadHandler();
  const open = useCallback(
    (task: HqAppTask, mateProjectId: string) =>
      openTaken(
        task,
        (deadline) => {
          const lookup = findCandidate(listing, (row) => row.project.id === mateProjectId);
          const linked = lookup.kind === "found" ? lookup.row.environmentId : undefined;
          if (linked !== undefined) return Promise.resolve(linked);
          // Its door connects it first, and tells which environment it opened in.
          return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
            const kind = openMate(
              lookup.kind === "found" ? lookup.row : { projectId: mateProjectId },
              (opened) => {
                clearTimeout(timer);
                resolve(opened.environmentId);
              },
            );
            if (kind === "going") {
              clearTimeout(timer);
              resolve(null);
            }
          });
        },
        handleNewThread,
      ),
    [handleNewThread, listing, openMate],
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

/** A stranded Take in the Mate's conversation: its words, and its Open its conversation. */
export interface StrandedTakeHere {
  readonly taskId: string;
  readonly title: string;
  /** This tab is opening its conversation now. */
  readonly opening: boolean;
  /** Opens its conversation; `null` while its Board record (its brief) is not read. */
  readonly open: (() => void) | null;
}

const NOTHING_HERE: ReadonlyArray<StrandedTakeHere> = [];

/**
 * The reader's stranded Takes in the Mate of `environmentId` (`strandedTakesAtom`), said where they
 * land for that Mate — its conversations — each with **Open its conversation**, which opens it here
 * under the same task; its Board is read for the task's brief only while one is stranded.
 */
export function useStrandedTakesHere(
  environmentId: EnvironmentId,
): ReadonlyArray<StrandedTakeHere> {
  const all = useAtomValue(strandedTakesAtom);
  const here = useMemo(
    () => all.filter((take) => take.environmentId === environmentId),
    [all, environmentId],
  );
  const board = useAppTaskSource("hqAppTasks", here[0]?.appId ?? null);
  const setting = board.read.setting;
  const held = setting.state === "known" ? setting.held : null;
  const pressing = useTakeOpenings();
  const handleNewThread = useNewThreadHandler();
  return useMemo(() => {
    if (here.length === 0) return NOTHING_HERE;
    return here.map((take) => {
      const task = held?.find((each) => each.id === take.taskId);
      return {
        taskId: take.taskId,
        title: take.title,
        opening: pressing.has(take.taskId),
        open:
          task === undefined || task.source === undefined
            ? null
            : () => {
                void openTaken(task, () => Promise.resolve(environmentId), handleNewThread);
              },
      };
    });
  }, [environmentId, handleNewThread, held, here, pressing]);
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
 * The task whose answer field the Board focuses as its row is drawn: asked by a press that opens
 * the Board to answer it, taken by the first row that draws it. The tab's own, never kept.
 */
let answerOnArrival: string | null = null;

/** Whether the Board's row of `taskId` takes the focus an opening press asked for it, once. */
export function takeAnswerOnArrival(taskId: string): boolean {
  if (answerOnArrival !== taskId) return false;
  answerOnArrival = null;
  return true;
}

/**
 * Where the person who put a task on the Board answers its question: their own card in the chat they
 * put it from, where the Board read says which; else the application's Board, on its page, with
 * that task's answer field focused (a task put on the Board itself is answered in its row).
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
      answerOnArrival = task.taskId;
      void router.navigate({ to: "/group/$groupId/board", params: { groupId: appId } });
    },
    [openConversation, orgId, placements, router, store],
  );
}
