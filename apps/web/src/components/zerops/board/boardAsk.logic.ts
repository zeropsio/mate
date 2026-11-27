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

/** One board ask of the thread as JSON, so the card draws again only when it changes. */
export function boardAskKey(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  requestId: string,
): string {
  const activity = (activities ?? []).find(
    (candidate) =>
      candidate.kind === BOARD_ASK_ACTIVITY_KIND &&
      (candidate.payload as BoardAskActivityPayload).requestId === requestId,
  );
  return activity === undefined ? "" : JSON.stringify(activity.payload);
}

export const boardAskFromKey = (key: string): BoardAskActivityPayload | null =>
  key === "" ? null : (JSON.parse(key) as BoardAskActivityPayload);

/** The card's done line once it is on the Board. */
export const ON_THE_BOARD = "On the board";

/**
 * Where a task put from this conversation stands, in a word or two after the done line: Queued, In
 * progress, Taken, Asks you, Up for review, then how it ended.
 */
export function boardTaskStateWords(row: BoardRow): string {
  switch (row.lane) {
    case "queued":
      return TASK_STATUS_WORDS.queued;
    case "progress":
      return row.holder?.kind === "person" ? TASK_STATUS_WORDS.taken : "In progress";
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
