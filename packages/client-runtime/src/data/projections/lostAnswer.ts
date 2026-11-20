import { HISTORY_PAGE, runsStill } from "../families/process.ts";
import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import type { OperationIntent } from "../model.ts";

/**
 * How far before a press Zerops' `created` (its servers' clock) may stand for a process the press
 * itself caused, read against `since` (this browser's clock): the skew between a laptop and
 * Zerops. A laptop kept by network time is off by well under a second, one that missed its sync
 * for days by tens of seconds; two minutes covers that with room. Smaller risks a false "not
 * sent"; larger only widens the span in which an ended process nobody saw at the press makes the
 * answer "cannot tell".
 *
 * Limit: the allowance covers a laptop clock ahead of Zerops only. With the laptop behind, an
 * earlier process the store had not seen at the press can bear a `created` at or after `since`
 * and is taken for this press's: a false "accepted". No fact tells the two apart without
 * comparing the two clocks: the PUT's answer names this press's process, but after a lost answer
 * nothing does; Zerops sends no time of its own with a process, and the PUT carries no id a
 * process echoes. The same allowance after the press would make every quick write of ours
 * "cannot tell", so the case stays open.
 */
export const PRESS_CLOCK_ALLOWANCE_MS = 2 * 60_000;

/**
 * The processes that may answer one write's press: its action on its own service, still running
 * or created at or after the press (`since`). Asked at the press (no `seen`), the baseline: every
 * one that could later be taken for its answer, ended ones created within the clocks' allowance
 * before it included. Asked after the send (`seen`, that baseline), `null` — cannot tell — where
 * an ended one created within the allowance before the press was not seen at it: it is this
 * press's or an earlier one; `null` too where the history read (`page`, the project's newest
 * processes as Zerops listed them) is a full page whose oldest is newer than that allowance: older
 * ones it cut off may hold one. Without a press time, running ones only, and `null` where none
 * runs: an ended one cannot be told from an earlier write's.
 */
export function processEffects(
  processes: ReadonlyArray<ProcessValue>,
  ask: {
    readonly serviceId: string;
    readonly action: string;
    readonly since: number | undefined;
    readonly seen: ReadonlyArray<string> | undefined;
  },
  page: ReadonlyArray<ProcessValue>,
): ReadonlyArray<string> | null {
  const { since, seen } = ask;
  if (
    since !== undefined &&
    seen !== undefined &&
    page.length >= HISTORY_PAGE &&
    page.every((process) => Date.parse(process.created) >= since - PRESS_CLOCK_ALLOWANCE_MS)
  )
    return null;
  let unsure = false;
  const shown = processes
    .filter((process) => {
      if (process.actionName !== ask.action || !process.serviceStackIds.includes(ask.serviceId))
        return false;
      if (runsStill(process.status)) return true;
      if (since === undefined) return false;
      const created = Date.parse(process.created);
      if (created < since - PRESS_CLOCK_ALLOWANCE_MS) return false;
      if (created >= since || seen === undefined) return true;
      if (!seen.includes(process.id)) unsure = true;
      return false;
    })
    .map((process) => process.id);
  if (unsure || (since === undefined && shown.length === 0)) return null;
  return shown;
}

/**
 * What an owner that keeps no request ids shows, after a lost answer, of one operation: the one
 * effect handle that can only be its own — absent when it was sent (`before`), held by no other
 * operation still under way (`claimed`) — to adopt; `"none"`, the request never taken, only where
 * absence is proved (`proving`: the owner's facts read afresh on the person's own ask); else
 * `null`, cannot tell — more than one, no baseline, facts that cannot say (`shown` null), or none
 * shown by facts that do not prove it. A lost answer can still be taken by its owner: absence
 * claimed on anything less invites a second effect.
 */
export function lostAnswerEffect(input: {
  readonly shown: ReadonlyArray<string> | null;
  readonly before: ReadonlyArray<string> | undefined;
  readonly claimed: ReadonlySet<string>;
  readonly proving: boolean;
}): string | "none" | null {
  const { shown, before, claimed } = input;
  if (shown === null || before === undefined) return null;
  const candidates = shown.filter((handle) => !before.includes(handle) && !claimed.has(handle));
  if (candidates.length === 0) return input.proving ? "none" : null;
  return candidates.length === 1 ? candidates[0]! : null;
}

const serviceOf = (intent: {
  readonly orgId: string;
  readonly projectId: string;
  readonly serviceId: string;
}) => ({ orgId: intent.orgId, projectId: intent.projectId, serviceId: intent.serviceId });

/**
 * The one process on one service whose existence answers a write after a lost answer — its
 * action, and what the person reads when Zerops shows none since the press — or `null` for a
 * write whose effect is not one such process. The one pairing of operation kind and process
 * action, read by the kinds' `effectHandles` and by the executor that reads the history afresh.
 */
export function effectProcessOf(intent: OperationIntent): {
  readonly orgId: string;
  readonly projectId: string;
  readonly serviceId: string;
  readonly action: string;
  readonly absent: string;
} | null {
  switch (intent.kind) {
    case "mate-restart":
      // The way's last verb: never a stop, which alone would end it with the container stopped.
      return {
        orgId: intent.orgId,
        projectId: intent.projectId,
        serviceId: intent.serviceId,
        action: intent.way === "restart" ? "stack.restart" : "stack.start",
        absent: "Zerops shows no restart of this Mate since you asked.",
      };
    case "start-service":
      return {
        ...serviceOf(intent),
        action: "stack.start",
        absent: "Zerops shows no start since you asked.",
      };
    case "stop-service":
      return {
        ...serviceOf(intent),
        action: "stack.stop",
        absent: "Zerops shows no stop since you asked.",
      };
    case "service-restart":
      return {
        ...serviceOf(intent),
        action: "stack.restart",
        absent: "Zerops shows no restart since you asked.",
      };
    default:
      return null;
  }
}
