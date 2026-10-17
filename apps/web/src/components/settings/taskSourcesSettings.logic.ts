/**
 * What Settings › Zerops › HQ says of where automated Mates take tasks from besides GitHub — the
 * organization's Slack app and Discord application, an application's channel on each, its
 * webhooks and schedules, the limits on each task — and what its forms take.
 */
import type { AutomationAction, SettingValue, TaskSourceWrite } from "@t3tools/client-runtime/data";
import type { HqScheduleRule, HqSlackView, HqTaskLimitsView } from "@t3tools/shared/hqIntake";

/**
 * What a section shows of its setting: `reading` in its final shape, `hidden` where this HQ
 * predates it (the one "Update HQ" line says so), `withheld` from a viewer HQ refuses, `failed`
 * with HQ's words and *Read again*, or what is `known`.
 */
export type SectionState = "reading" | "hidden" | "withheld" | "failed" | "known";

export function sectionState(setting: SettingValue<unknown>): SectionState {
  switch (setting.state) {
    case "unread":
    case "reading":
      return "reading";
    case "unsupported":
      return "hidden";
    case "withheld":
      return "withheld";
    case "failed":
      return "failed";
    case "known":
      return "known";
  }
}

/** Whether HQ predates these settings: any of the organization's says so. */
export function taskSourcesUnsupported(settings: ReadonlyArray<SettingValue<unknown>>): boolean {
  return settings.some((setting) => setting.state === "unsupported");
}

export function slackLine(view: Pick<HqSlackView, "connected" | "workspace">): string {
  if (!view.connected) return "Not connected";
  return view.workspace === null ? "Connected" : `Connected to ${view.workspace}`;
}

/** The channel an application takes tasks from, by its name. */
export function channelLine(view: { readonly channel: string }): string {
  return `Takes tasks from #${view.channel}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Every Monday at 09:00, Europe/Prague". */
export function scheduleLine(rule: HqScheduleRule): string {
  const when =
    rule.every === "day"
      ? "Every day"
      : rule.every === "weekday"
        ? "Every weekday"
        : `Every ${DAYS[rule.day ?? 1]}`;
  return `${when} at ${rule.at}, ${rule.timeZone}`;
}

/** When a schedule runs next, in the viewer's words for a moment (`moment`); or that it rests. */
export function scheduleNextLine(nextAt: string | null, moment: (iso: string) => string): string {
  return nextAt === null ? "Paused" : `Next ${moment(nextAt)}`;
}

const dollars = (amount: number) =>
  Number.isInteger(amount) ? `$${String(amount)}` : `$${amount.toFixed(2)}`;

export function limitsLine(limits: HqTaskLimitsView): string {
  const minutes = `${String(limits.minutes)} ${limits.minutes === 1 ? "minute" : "minutes"} of work`;
  return limits.costUsd === null
    ? `A task stops after ${minutes}.`
    : `A task stops after ${minutes} or ${dollars(limits.costUsd)} of model use.`;
}

/** What a write under way says on its press's line. */
export function workingWords(verb: TaskSourceWrite["kind"]): string {
  switch (verb) {
    case "slack-connect":
    case "discord-connect":
      return "Connecting…";
    case "slack-disconnect":
    case "discord-disconnect":
      return "Disconnecting…";
    case "webhook-make":
    case "schedule-make":
      return "Making…";
    case "webhook-delete":
    case "schedule-delete":
      return "Deleting…";
    case "channel-stop":
      return "Stopping…";
    case "channel":
    case "discord-allow":
    case "task-limits":
      return "Saving…";
  }
}

/** A write's refusal, or its lost answer, in HQ's words; nothing otherwise. */
export function taskSourceProblem(action: AutomationAction<string>): string | null {
  return action.kind === "failed" || action.kind === "unresolved" ? action.words : null;
}

/** The limits as typed: minutes a whole number ≥ 1, cost an amount above zero or none. */
export function readLimits(
  minutes: string,
  cost: string,
): { readonly limits: HqTaskLimitsView } | { readonly error: string } {
  const typedMinutes = minutes.trim();
  const whole = Number(typedMinutes);
  if (!/^\d+$/u.test(typedMinutes) || whole < 1)
    return { error: "Minutes are a whole number of at least 1." };
  const typedCost = cost.trim();
  if (typedCost === "") return { limits: { minutes: whole, costUsd: null } };
  const amount = Number(typedCost);
  if (!Number.isFinite(amount) || amount <= 0)
    return { error: "Cost is an amount above $0, or empty for none." };
  return { limits: { minutes: whole, costUsd: amount } };
}

/** The Discord allowlist after one ID added or removed, as HQ takes it: whole, each once. */
export function allowlistAfter(
  held: ReadonlyArray<string>,
  change: { readonly add: string } | { readonly remove: string },
): { readonly userIds: ReadonlyArray<string> } | { readonly error: string } {
  if ("remove" in change) return { userIds: held.filter((id) => id !== change.remove) };
  const id = change.add.trim();
  if (!/^\d{5,25}$/u.test(id)) return { error: "A Discord user ID is a long number." };
  return { userIds: held.includes(id) ? held : [...held, id] };
}
