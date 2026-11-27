/**
 * Work the agent proposes to put on its application's Board, read off zcp's answer to
 * `zerops_board_propose`: a title and a self-contained brief. zcp writes nothing and answers at
 * once; the engine opens the ask on that call and the person, on its card, may edit both before
 * their client puts the task on the Board as them. The agent never writes a task.
 *
 * @module engine/pump/boardAsk
 */
import type { ItemBody, RequestAsk } from "@t3tools/contracts";
import { BOARD_BRIEF_MAX, BOARD_TITLE_MAX } from "@t3tools/shared/hqIntake";

import { isRecord, zcpAnswerOfCall } from "./vaultAsk.ts";

/** zcp's tool that proposes work for the Board (`{proposed:{board:{title, brief}}}`). */
export const BOARD_PROPOSE_TOOL = "zerops_board_propose";

/**
 * The ask a closed call made of the person, its title and brief cut to what HQ takes; `null` for
 * every other call, or an answer without both.
 */
export function boardAskOfCall(body: ItemBody): Extract<RequestAsk, { kind: "board" }> | null {
  const proposed = zcpAnswerOfCall(body, BOARD_PROPOSE_TOOL)?.proposed;
  const board = isRecord(proposed) ? proposed.board : undefined;
  if (!isRecord(board)) return null;
  const { title, brief } = board;
  if (typeof title !== "string" || typeof brief !== "string") return null;
  const said = { title: title.trim().slice(0, BOARD_TITLE_MAX), brief: brief.trim() };
  if (said.title === "" || said.brief === "") return null;
  return { kind: "board", title: said.title, brief: said.brief.slice(0, BOARD_BRIEF_MAX) };
}
