/**
 * Work the Mate proposed for the application's Board (`zerops_board_propose`): its card shows the
 * title and the brief, editable, and its Put on board is the person's own write to HQ, after which
 * the engine hears the task's id. The card's state is the engine's record and this card's put
 * (`appTaskPut`); the tab holds nothing else.
 */
import {
  BOARD_ASK_ACTIVITY_KIND,
  type BoardAskActivityPayload,
  type TaskWriteAction,
} from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { TASK_STATUS_WORDS } from "~/zerops/taskStatus";

import { type AskState, notNowWords } from "../../ask/ask.logic";
import type { BoardRow } from "../projectAutomation/taskBoard.logic";
import type { BoardAnswerState } from "./BoardTaskRow";

/**
 * Where its putter's answer to a task stands, from this account's latest write to the task
 * (`appTaskWrites`): another write (a stop, a take) says nothing of the answer.
 */
export function boardAnswerState(write: TaskWriteAction | undefined): BoardAnswerState {
  if (write === undefined || write.kind === "idle") return { kind: "idle" };
  if (write.kind === "working")
    return write.verb === "task-message" ? { kind: "sending" } : { kind: "idle" };
  if (write.kind === "done")
    return write.verb === "task-message" ? { kind: "sent" } : { kind: "idle" };
  return { kind: "refused", words: write.words };
}

/** Where a board ask stands in the timeline: the run card it was asked in. */
export interface BoardAskPlace {
  readonly requestId: string;
  readonly turnId: TurnId;
  readonly createdAt: string;
}

/** The timeline row that holds a board ask's card. */
export const boardAskRowId = (requestId: string): string => `board-request:${requestId}`;

/**
 * The thread's board asks as one string — a line each: its request, run card and time — so a
 * change elsewhere in the thread draws nothing new in the timeline.
 */
export function boardAskPlacesKey(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
): string {
  return (activities ?? [])
    .flatMap((activity) => {
      if (activity.kind !== BOARD_ASK_ACTIVITY_KIND || activity.turnId === null) return [];
      const payload = activity.payload as BoardAskActivityPayload;
      return [[payload.requestId, activity.turnId, activity.createdAt].join("\t")];
    })
    .join("\n");
}

/** The places back from their string: a card per ask. */
export function boardAskPlaces(key: string): ReadonlyArray<BoardAskPlace> {
  if (key === "") return [];
  return key.split("\n").map((line) => {
    const [requestId = "", turnId = "", createdAt = ""] = line.split("\t");
    return { requestId, turnId: turnId as TurnId, createdAt };
  });
}

/**
 * A selector of one board ask of the thread: its payload, the same object while its revision —
 * where the ask stands, who answered when, the tasks it put — is the same, so a change elsewhere
 * in the thread draws nothing new on the card. Its title, brief and plan never change once asked.
 */
export function boardAskSelector(
  requestId: string,
): (
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
) => BoardAskActivityPayload | null {
  let last: { readonly revision: string; readonly payload: BoardAskActivityPayload } | null = null;
  return (activities) => {
    const activity = (activities ?? []).find(
      (candidate) =>
        candidate.kind === BOARD_ASK_ACTIVITY_KIND &&
        (candidate.payload as BoardAskActivityPayload).requestId === requestId,
    );
    if (activity === undefined) {
      last = null;
      return null;
    }
    const payload = activity.payload as BoardAskActivityPayload;
    const revision = [
      payload.state,
      payload.answer?.at ?? "",
      payload.taskId ?? "",
      (payload.taskIds ?? []).join(","),
    ].join("\t");
    if (last?.revision !== revision) last = { revision, payload };
    return last.payload;
  };
}

/** The card's done line once it is on the Board. */
export const ON_THE_BOARD = "On the board";

/**
 * Where a task put from this conversation stands, in a word or two after the done line: Waits for
 * other tasks, Queued, In progress, Asks you (or Waits on you, a need of it broken), Up for
 * review, then how it ended.
 */
export function boardTaskStateWords(row: BoardRow): string {
  switch (row.lane) {
    case "queued":
      return TASK_STATUS_WORDS[row.status === "held" ? "held" : "queued"];
    case "progress":
      return TASK_STATUS_WORDS.taken;
    case "waiting":
      return row.state ?? "Asks you";
    case "review":
      return TASK_STATUS_WORDS.review;
    case "done":
      return TASK_STATUS_WORDS[row.status];
  }
}

/**
 * The card's state: the engine's record first (put, declined, closed), else this card's put to
 * HQ as it stands — working, refused (its words), or answered with the engine not told yet.
 */
export function boardAskState(input: {
  readonly state: BoardAskActivityPayload["state"];
  readonly put: TaskWriteAction;
  /** The engine refused the card's answer, in its words. */
  readonly refusal: string | null;
  /** Who answered and when, in the reader's words; `null` where unknown. */
  readonly by: string | null;
  readonly at: string | null;
  /** The task it put, as the Board reads it; `null` while not read, or not known. */
  readonly task?: BoardRow | null;
}): AskState {
  switch (input.state) {
    case "put": {
      const task = input.task ?? null;
      if (task === null) return { kind: "done", words: ON_THE_BOARD, told: null };
      const words = `${ON_THE_BOARD} · ${boardTaskStateWords(task)}`;
      // Stopped or failed: off the Board's way, said quietly; else it moves on as it should.
      return task.status === "failed" || task.status === "stopped"
        ? { kind: "replaced", words }
        : { kind: "done", words, told: null };
    }
    case "declined":
      return { kind: "notNow", words: notNowWords(input.by, input.at) };
    case "closed":
      return { kind: "replaced", words: "This proposal was closed." };
    case "open":
      break;
  }
  if (input.refusal !== null) return { kind: "failed", words: input.refusal };
  switch (input.put.kind) {
    case "working":
      return { kind: "working", words: "Putting it on the Board…", pressed: "main" };
    case "failed":
    case "unresolved":
      return { kind: "failed", words: input.put.words };
    case "done":
      return { kind: "working", words: "Putting it on the Board…", pressed: "main" };
    case "idle":
      return { kind: "waiting" };
  }
}

/** Where a plan's task stands, in the few words its card's done line counts it by. */
function planTaskWords(row: BoardRow): string {
  switch (row.lane) {
    case "queued":
      return row.status === "held" ? "waiting for others" : "queued";
    case "progress":
      return "in progress";
    case "waiting":
      return row.broken.length > 0 ? "waiting on a person" : "asking";
    case "review":
      return "up for review";
    case "done":
      return TASK_STATUS_WORDS[row.status].toLowerCase();
  }
}

/**
 * A plan's done line once it is on the Board: how many of its tasks stand where, in the order they
 * first stand there ("On the board · 1 in progress · 2 waiting for others"); its words alone while
 * the Board has not answered them.
 */
export function planDoneWords(rows: ReadonlyArray<BoardRow | null>): string {
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row !== null) {
      const words = planTaskWords(row);
      counts.set(words, (counts.get(words) ?? 0) + 1);
    }
  const parts = [...counts].map(([words, count]) => `${String(count)} ${words}`);
  return [ON_THE_BOARD, ...parts].join(" · ");
}

/**
 * What a plan's task needs, in the plan's own numbers: "After #1", "After #1 and #3"; a need on a
 * task already on the Board (by id, not a key of the plan) says so. `null`: it needs none. It is
 * the plan's order, said the same once on the Board, where each task's row says where it stands.
 */
export function planNeedsWords(
  needs: ReadonlyArray<string>,
  keys: ReadonlyArray<string>,
): string | null {
  if (needs.length === 0) return null;
  const numbers = needs.flatMap((need) => {
    const at = keys.indexOf(need);
    return at === -1 ? [] : [`#${String(at + 1)}`];
  });
  const outside = needs.length - numbers.length;
  const said = [
    ...numbers,
    ...(outside === 0 ? [] : [outside === 1 ? "a task on the Board" : "tasks on the Board"]),
  ];
  const listed =
    said.length <= 1 ? said.join("") : `${said.slice(0, -1).join(", ")} and ${said.at(-1) ?? ""}`;
  return `After ${listed}`;
}

/**
 * A plan card's state: the engine's record first, its done line following the plan's tasks on the
 * Board — quiet once every one of them stopped or failed — else this card's put to HQ as it stands.
 */
export function boardPlanState(input: {
  readonly state: BoardAskActivityPayload["state"];
  readonly put: TaskWriteAction;
  readonly refusal: string | null;
  readonly by: string | null;
  readonly at: string | null;
  /** The plan's tasks as the Board reads them, in its order; `null` for one not read. */
  readonly tasks: ReadonlyArray<BoardRow | null>;
}): AskState {
  if (input.state === "put") {
    const words = planDoneWords(input.tasks);
    const read = input.tasks.filter((row) => row !== null);
    return read.length > 0 &&
      read.length === input.tasks.length &&
      read.every((row) => row.status === "failed" || row.status === "stopped")
      ? { kind: "replaced", words }
      : { kind: "done", words, told: null };
  }
  const single = boardAskState({ ...input, task: null });
  return single.kind === "working"
    ? { ...single, words: "Putting the plan on the Board…" }
    : single;
}
