/**
 * A board ask as the conversation draws it (`BoardAskCardView`): the work the Mate proposed for its
 * application's Board, its title and brief editable while it waits, with **Put on board** — the
 * person's own write to HQ (`useBoardTaskWrites`), after which the engine hears the task's id — and
 * Not now. Once put, the card follows the task the engine recorded it became (its answer's
 * `taskId`, or this tab's put before the engine said so) on the Board as HQ answers it, re-read on
 * the application's Board revision: its state on the done line, who has it, its change, and a pool
 * Mate's question with the answer field for its putter (`answerTaskPermission`).
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { hqPlacementsAtom } from "~/state/zerops";
import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useBoardOffers, useMateFaces } from "~/zerops/useBoardTasks";
import { useNowMs } from "~/zerops/useNowMs";
import {
  useAppTaskPut,
  useAppTaskSource,
  useAppTaskStops,
  useBoardTaskWrites,
} from "~/zerops/useTaskSourceSettings";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { useApplicationOfProject } from "~/components/zerops/useGitEnvironmentFormInputs";
import { boardOf } from "../projectAutomation/taskBoard.logic";
import { BoardAskCardView } from "./BoardAskCard";
import type { BoardAnswerState } from "./BoardTaskRow";
import { boardAskFromKey, boardAskKey, boardAskState } from "./boardAsk.logic";

export function BoardAskCardContainer({
  requestId,
  environmentId,
  threadRef,
}: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  // As a string, so a change elsewhere in the thread draws nothing here.
  const key = useThreadDetail(
    threadRef,
    useMemo(
      () => (detail: { readonly activities?: unknown } | null) =>
        boardAskKey(detail?.activities as Parameters<typeof boardAskKey>[0], requestId),
      [requestId],
    ),
  );
  const ask = useMemo(() => boardAskFromKey(key), [key]);
  if (ask === null || environmentId === null || threadRef === null) return null;
  return <BoardAsk ask={ask} environmentId={environmentId} threadRef={threadRef} />;
}

function BoardAsk({
  ask,
  environmentId,
  threadRef,
}: {
  readonly ask: NonNullable<ReturnType<typeof boardAskFromKey>>;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const { requestId } = ask;
  const mate = useKnownMate(environmentId);
  const mateName = mate?.name ?? "Your Mate";
  const location = useMateOfEnvironment(environmentId);
  const mateProjectId = location?.projectId ?? mate?.projectId;
  const app = useApplicationOfProject(mateProjectId);
  const appId = app?.id ?? null;
  const writes = useBoardTaskWrites(appId);
  const put = useAppTaskPut(appId, requestId);
  const answerBoardAsk = useAtomCommand(threadEnvironment.answerBoardAsk, {
    reportFailure: false,
  });
  const [title, setTitle] = useState(ask.title);
  const [brief, setBrief] = useState(ask.brief);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The task this card put, until the engine took it: a Try again tells the engine, never puts again.
  const [putTaskId, setPutTaskId] = useState<string | null>(null);
  const taskId = ask.taskId ?? putTaskId;
  const task = useFollowedTask(appId, taskId);

  const tell = async (said: { outcome: "put"; taskId: string } | { outcome: "declined" }) => {
    setRefusal(null);
    const result = await answerBoardAsk({
      environmentId,
      input: { threadId: threadRef.threadId, requestId, ...said },
    });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    setRefusal(error instanceof Error ? error.message : "The Mate did not take the answer.");
  };
  const putOnBoard = async () => {
    if (putTaskId !== null) return tell({ outcome: "put", taskId: putTaskId });
    if (writes === null || mateProjectId === undefined) return;
    const made = await writes.put(requestId, {
      title: title.trim(),
      brief: brief.trim(),
      from: { mateProjectId, conversationId: threadRef.threadId },
    });
    if (made === null) return;
    setPutTaskId(made.id);
    await tell({ outcome: "put", taskId: made.id });
  };

  const state = boardAskState({
    state: ask.state,
    put,
    refusal,
    by: null,
    at: null,
    task: task?.row ?? null,
  });
  const ready =
    writes !== null && mateProjectId !== undefined && title.trim() !== "" && brief.trim() !== "";
  return (
    <BoardAskCardView
      appName={app?.name ?? null}
      brief={brief}
      editable={
        putTaskId === null &&
        (state.kind === "waiting" || state.kind === "failed" || state.kind === "working")
      }
      mateName={mateName}
      onBrief={setBrief}
      onNotNow={() => void tell({ outcome: "declined" })}
      onPut={() => void putOnBoard()}
      onTitle={setTitle}
      ready={ready}
      requestId={requestId}
      state={state}
      task={task}
      title={title.trim() === "" ? ask.title : title}
    />
  );
}

/**
 * The task a card put, as the Board reads it, in its row's words: who has it, its change, and the
 * question a pool Mate asks its putter with the field to answer it, offered by the one rule. `null`
 * while none is named, or the Board has not answered it.
 */
function useFollowedTask(appId: string | null, taskId: string | null) {
  const board = useAppTaskSource("hqAppTasks", taskId === null ? null : appId);
  const setting = board.read.setting;
  const record =
    taskId === null || setting.state !== "known"
      ? undefined
      : setting.held.find((each) => each.id === taskId);
  const session = useZeropsSessionOptional();
  const personName = useHqPersonNames(session?.activeOrganization?.id);
  const faces = useMateFaces();
  const placements = useAtomValue(hqPlacementsAtom);
  const nowMs = useNowMs(record !== undefined);
  const offers = useBoardOffers(appId);
  const writes = useBoardTaskWrites(appId);
  const asked = useAppTaskStops(appId, taskId === null ? [] : [taskId]);
  const navigate = useNavigate();
  // What navigation says of it now, while a pool Mate is on it: its question, its stop.
  let live: HqNavigationMateTask | undefined;
  if (placements !== null)
    for (const placement of placements.values())
      if (placement.mate?.task?.id === taskId) live = placement.mate.task ?? undefined;
  if (record === undefined || taskId === null) return null;
  const row = boardOf([record], nowMs, {
    ...(appId === null ? {} : { appId }),
    live: live === undefined ? new Map() : new Map([[taskId, live]]),
    viewerId: session?.user?.id,
    personName,
    mateName: (projectId) => faces.get(projectId)?.name,
  }).lanes;
  const shown = row.queued[0] ?? row.progress[0] ?? row.waiting[0] ?? row.review[0] ?? row.done[0];
  if (shown === undefined) return null;
  const write = asked.stops[taskId];
  const answerState: BoardAnswerState =
    write === undefined || write.kind === "idle"
      ? { kind: "idle" }
      : write.kind === "working"
        ? write.verb === "task-message"
          ? { kind: "sending" }
          : { kind: "idle" }
        : write.kind === "done"
          ? write.verb === "task-message"
            ? { kind: "sent" }
            : { kind: "idle" }
          : { kind: "refused", words: write.words };
  return {
    row: shown,
    face: shown.holder === null ? undefined : faces.get(shown.holder.projectId),
    question: shown.lane === "waiting" ? record.detail : null,
    answer:
      offers?.tasks[taskId]?.answer === true && writes !== null
        ? { state: answerState, onSend: (text: string) => writes.answer(taskId, text) }
        : undefined,
    onOpenChange: (href: string) => {
      void navigate({ href });
    },
  };
}
