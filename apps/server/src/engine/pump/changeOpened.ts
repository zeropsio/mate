/**
 * A change in HQ the agent opened, read off zcp's answer to `zerops_workflow
 * action="open-change"`: its number (`pullRequest`) and its address (`pullRequestUrl`,
 * `<hq>/changes/<appId>/<repo>/<n>`), which names its repository. Every agent opens a change
 * through this one tool, so the conversation that called it is the one that opened the change,
 * whichever agent it runs: what links a taken task's change to its task (`task.change`).
 *
 * @module engine/pump/changeOpened
 */
import type { ItemBody } from "@t3tools/contracts";

import { zcpAnswerOfCall } from "./vaultAsk.ts";

/** zcp's tool whose `open-change` action opens a change in HQ. */
export const CHANGE_OPEN_TOOL = "zerops_workflow";

/** A change's address as zcp words it: `/changes/<appId>/<repo>/<n>` at HQ's origin. */
const CHANGE_PATH = /^\/changes\/[^/]+\/([^/]+)\/([1-9]\d{0,8})$/u;

/** The action of the tool that opens a change; its describe and close answer the same fields. */
export const CHANGE_OPEN_ACTION = "open-change";

/**
 * The change a closed `open-change` call answered open, by repository and number; `null` for
 * every other call — another action of the same tool (`describe-change`, `close-change`) names the
 * same change in the same fields and opens none. `args` are the call's arguments as its agent gave
 * them (`SpiToolCall.arguments`).
 */
export function changeOpenedOfCall(
  body: ItemBody,
  args: unknown,
): { readonly repo: string; readonly number: number } | null {
  if (typeof args !== "object" || args === null || !("action" in args)) return null;
  if (args.action !== CHANGE_OPEN_ACTION) return null;
  const answer = zcpAnswerOfCall(body, CHANGE_OPEN_TOOL);
  const number = answer?.pullRequest;
  const url = answer?.pullRequestUrl;
  if (typeof number !== "number" || typeof url !== "string") return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const matched = CHANGE_PATH.exec(path);
  if (matched === null || Number(matched[2]) !== number) return null;
  let repo: string;
  try {
    repo = decodeURIComponent(matched[1]!);
  } catch {
    return null;
  }
  return repo.trim() === "" ? null : { repo, number };
}
