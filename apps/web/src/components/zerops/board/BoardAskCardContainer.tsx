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
import { BoardPlanCardView } from "./BoardPlanCard";
import {
  boardAnswerState,
  boardAskSelector,
  boardAskState,
  boardPlanState,
  planNeedsWords,
} from "./boardAsk.logic";

type BoardAskPayload = NonNullable<ReturnType<ReturnType<typeof boardAskSelector>>>;

export function BoardAskCardContainer({
  requestId,
  environmentId,
  threadRef,
}: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  // The same payload while its revision is: a change elsewhere in the thread draws nothing here.
  const ask = useThreadDetail(
    threadRef,
    useMemo(() => {
      const select = boardAskSelector(requestId);
      return (detail: { readonly activities?: unknown } | null) =>
        select(detail?.activities as Parameters<typeof select>[0]);
    }, [requestId]),
  );
  if (ask === null || environmentId === null || threadRef === null) return null;
  // A plan proposed in one go is one card; older records carry no plan (`plan` absent).
  if (ask.plan != null && ask.plan.length > 0)
    return (
      <BoardPlan
        ask={{ ...ask, plan: ask.plan }}
        environmentId={environmentId}
        threadRef={threadRef}
      />
    );
  return <BoardAsk ask={ask} environmentId={environmentId} threadRef={threadRef} />;
}

function BoardAsk({
  ask,
  environmentId,
  threadRef,
}: {
  readonly ask: BoardAskPayload;
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
 * A plan proposed for the Board, as one card: its tasks' titles and briefs editable while it waits,
 * with **Put on board** — the person's own write to HQ of the whole plan, all or nothing
 * (`useBoardTaskWrites`'s `plan`), after which the engine hears its tasks' ids — and Not now. Once
 * put, the card follows each task the engine recorded (or this tab's put before it said so).
 */
function BoardPlan({
  ask,
  environmentId,
  threadRef,
}: {
  readonly ask: BoardAskPayload & { readonly plan: NonNullable<BoardAskPayload["plan"]> };
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const { requestId, plan } = ask;
  const mate = useKnownMate(environmentId);
  const location = useMateOfEnvironment(environmentId);
  const mateProjectId = location?.projectId ?? mate?.projectId;
  const app = useApplicationOfProject(mateProjectId);
  const appId = app?.id ?? null;
  const writes = useBoardTaskWrites(appId);
  const put = useAppTaskPut(appId, requestId);
  const answerBoardAsk = useAtomCommand(threadEnvironment.answerBoardAsk, {
    reportFailure: false,
  });
  const [titles, setTitles] = useState(() => plan.map((task) => task.title));
  const [briefs, setBriefs] = useState(() => plan.map((task) => task.brief));
  const [refusal, setRefusal] = useState<string | null>(null);
  // The tasks this card put, until the engine took them: a Try again tells the engine, never puts again.
  const [putTaskIds, setPutTaskIds] = useState<ReadonlyArray<string> | null>(null);
  const taskIds = ask.taskIds ?? putTaskIds;
  const followed = useFollowedTasks(appId, taskIds);

  const tell = async (
    said: { outcome: "put"; taskIds: ReadonlyArray<string> } | { outcome: "declined" },
  ) => {
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
    if (putTaskIds !== null) return tell({ outcome: "put", taskIds: putTaskIds });
    if (writes === null || mateProjectId === undefined) return;
    const made = await writes.plan(requestId, {
      from: { mateProjectId, conversationId: threadRef.threadId },
      tasks: plan.map((task, at) => ({
        key: task.key,
        title: (titles[at] ?? task.title).trim(),
        brief: (briefs[at] ?? task.brief).trim(),
        ...(task.needs.length === 0 ? {} : { needs: task.needs }),
      })),
    });
    if (made === null) return;
    const ids = made.map((task) => task.id);
    setPutTaskIds(ids);
    await tell({ outcome: "put", taskIds: ids });
  };

  const rows = (taskIds ?? []).map((id) => followed.get(id) ?? null);
  const state = boardPlanState({
    state: ask.state,
    put,
    refusal,
    by: null,
    at: null,
    tasks: taskIds === null ? [] : rows.map((row) => row?.row ?? null),
  });
  const written = (values: ReadonlyArray<string>) => values.every((value) => value.trim() !== "");
  const keys = plan.map((task) => task.key);
  return (
    <BoardPlanCardView
      appName={app?.name ?? null}
      editable={
        putTaskIds === null &&
        ask.taskIds === null &&
        (state.kind === "waiting" || state.kind === "failed" || state.kind === "working")
      }
      mateName={mate?.name ?? "Your Mate"}
      onBrief={(at, brief) => {
        setBriefs((now) => now.map((each, index) => (index === at ? brief : each)));
      }}
      onNotNow={() => void tell({ outcome: "declined" })}
      onPut={() => void putOnBoard()}
      put={taskIds !== null}
      onTitle={(at, title) => {
        setTitles((now) => now.map((each, index) => (index === at ? title : each)));
      }}
      ready={writes !== null && mateProjectId !== undefined && written(titles) && written(briefs)}
      requestId={requestId}
      state={state}
      tasks={plan.map((task, at) => ({
        key: task.key,
        title: titles[at] ?? task.title,
        brief: briefs[at] ?? task.brief,
        after: planNeedsWords(task.needs, keys),
        task: rows[at] ?? null,
      }))}
    />
  );
}

/**
 * The tasks a plan's card put, as the Board reads them, each in its row's words (who has it, its
 * change, what it waits for), by id; a task the Board has not answered is not in it.
 */
const NO_IDS: ReadonlyArray<string> = [];

function useFollowedTasks(appId: string | null, taskIds: ReadonlyArray<string> | null) {
  const board = useAppTaskSource("hqAppTasks", taskIds === null ? null : appId);
  const setting = board.read.setting;
  const session = useZeropsSessionOptional();
  const personName = useHqPersonNames(session?.activeOrganization?.id);
  const faces = useMateFaces();
  const nowMs = useNowMs(setting.state === "known");
  const navigate = useNavigate();
  const offers = useBoardOffers(appId);
  const writes = useBoardTaskWrites(appId);
  const asked = useAppTaskStops(appId, taskIds ?? NO_IDS);
  const placements = useAtomValue(hqPlacementsAtom);
  return useMemo(() => {
    const followed = new Map<
      string,
      Parameters<typeof BoardPlanCardView>[0]["tasks"][number]["task"] & {}
    >();
    if (taskIds === null || setting.state !== "known") return followed;
    const wanted = new Set(taskIds);
    // What navigation says of each now, while a pool Mate is on it: its question, its stop.
    const live = new Map<string, HqNavigationMateTask>();
    if (placements !== null)
      for (const placement of placements.values()) {
        const task = placement.mate?.task;
        if (task != null && wanted.has(task.id)) live.set(task.id, task);
      }
    // The whole read, so each task's needs are named by the tasks they wait for.
    const { lanes } = boardOf(setting.held, nowMs, {
      ...(appId === null ? {} : { appId }),
      live,
      viewerId: session?.user?.id,
      personName,
      mateName: (projectId) => faces.get(projectId)?.name,
    });
    for (const row of Object.values(lanes).flat()) {
      if (!wanted.has(row.id)) continue;
      // A pool Mate's question on it, with the field its putter answers it in (the one rule).
      const record = setting.held.find((each) => each.id === row.id);
      followed.set(row.id, {
        row,
        face: row.holder === null ? undefined : faces.get(row.holder.projectId),
        question:
          row.lane === "waiting" && row.broken.length === 0 ? (record?.detail ?? null) : null,
        answer:
          offers?.tasks?.[row.id]?.answer === true && writes !== null
            ? {
                state: boardAnswerState(asked.stops[row.id]),
                onSend: (text: string) => writes.answer(row.id, text),
              }
            : undefined,
        onOpenChange: (href: string) => {
          void navigate({ href });
        },
      });
    }
    return followed;
  }, [
    appId,
    asked.stops,
    faces,
    navigate,
    nowMs,
    offers,
    personName,
    placements,
    session?.user?.id,
    setting,
    taskIds,
    writes,
  ]);
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
  const answerState = boardAnswerState(asked.stops[taskId]);
  return {
    row: shown,
    face: shown.holder === null ? undefined : faces.get(shown.holder.projectId),
    question: shown.lane === "waiting" ? record.detail : null,
    answer:
      offers?.tasks?.[taskId]?.answer === true && writes !== null
        ? { state: answerState, onSend: (text: string) => writes.answer(taskId, text) }
        : undefined,
    onOpenChange: (href: string) => {
      void navigate({ href });
    },
  };
}
