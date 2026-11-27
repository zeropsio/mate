/**
 * Work the agent proposes to put on its application's Board, read off zcp's answer to
 * `zerops_board_propose`: a title and a self-contained brief, or a plan — several such tasks in the
 * order they go, each naming the plan's others it needs by their keys. zcp writes nothing and
 * answers at once; the engine opens the ask on that call and the person, on its card, may edit
 * every title and brief before their client puts the task, or the whole plan, on the Board as them.
 * The agent never writes a task.
 *
 * @module engine/pump/boardAsk
 */
import type { ItemBody, RequestAsk } from "@t3tools/contracts";
import { BOARD_BRIEF_MAX, BOARD_PLAN_MAX, BOARD_TITLE_MAX } from "@t3tools/shared/hqIntake";

import { isRecord, zcpAnswerOfCall } from "./vaultAsk.ts";

/** zcp's tool that proposes work for the Board (`{proposed:{board:{title, brief}}}` or `{…plan}`). */
export const BOARD_PROPOSE_TOOL = "zerops_board_propose";

/** The longest plan-local key the engine keeps (as HQ takes it). */
const PLAN_KEY_MAX = 64;

/** A title and a brief cut to what HQ takes; `null` where either is missing or blank. */
function said(title: unknown, brief: unknown): { title: string; brief: string } | null {
  if (typeof title !== "string" || typeof brief !== "string") return null;
  const cut = {
    title: title.trim().slice(0, BOARD_TITLE_MAX).trim(),
    brief: brief.trim().slice(0, BOARD_BRIEF_MAX),
  };
  return cut.title === "" || cut.brief === "" ? null : cut;
}

/**
 * A plan's tasks as zcp said them, in order: each with a key of its own, a title and a brief; what
 * each needs, its other tasks' keys (or tasks already on the Board, by id), never itself, each
 * once. `null` for a plan the person could not put as said: more tasks than HQ takes, a task
 * without its title, brief or key, or two with one key.
 */
function planOf(plan: ReadonlyArray<unknown>): Extract<RequestAsk, { kind: "board-plan" }> | null {
  if (plan.length === 0 || plan.length > BOARD_PLAN_MAX) return null;
  const tasks: Array<Extract<RequestAsk, { kind: "board-plan" }>["tasks"][number]> = [];
  for (const entry of plan) {
    if (!isRecord(entry)) return null;
    const words = said(entry.title, entry.brief);
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (words === null || key === "" || key.length > PLAN_KEY_MAX) return null;
    if (tasks.some((task) => task.key === key)) return null;
    const needs = Array.isArray(entry.needs)
      ? [
          ...new Set(
            entry.needs.flatMap((need) =>
              typeof need === "string" && need.trim() !== "" && need.trim() !== key
                ? [need.trim()]
                : [],
            ),
          ),
        ].slice(0, BOARD_PLAN_MAX)
      : [];
    tasks.push({ key, ...words, needs });
  }
  return { kind: "board-plan", tasks };
}

/**
 * The ask a closed call made of the person, its titles and briefs cut to what HQ takes: a plan's
 * card for a plan of two tasks or more, a single task's for one task (a plan of one, or a title and
 * a brief); `null` for every other call, or an answer that says neither.
 */
export function boardAskOfCall(
  body: ItemBody,
): Extract<RequestAsk, { kind: "board" | "board-plan" }> | null {
  const proposed = zcpAnswerOfCall(body, BOARD_PROPOSE_TOOL)?.proposed;
  const board = isRecord(proposed) ? proposed.board : undefined;
  if (!isRecord(board)) return null;
  if (Array.isArray(board.plan)) {
    const plan = planOf(board.plan);
    const [only] = plan?.tasks ?? [];
    if (plan === null || only === undefined) return null;
    return plan.tasks.length === 1 ? { kind: "board", title: only.title, brief: only.brief } : plan;
  }
  const single = said(board.title, board.brief);
  return single === null ? null : { kind: "board", ...single };
}
