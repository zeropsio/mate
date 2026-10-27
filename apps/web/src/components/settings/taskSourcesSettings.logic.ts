/**
 * What Settings › Zerops › HQ says of where automated Mates take tasks from besides GitHub — the
 * organization's Slack app and Discord application, an application's channel on each, its
 * webhooks and schedules, the limits on each task — and what its forms take.
 */
import type { AutomationAction, SettingValue, TaskSourceWrite } from "@t3tools/client-runtime/data";
import type { AutomatedModel } from "@t3tools/shared/openCodeKeyProviders";
import type {
  HqScheduleRule,
  HqSlackChannels,
  HqSlackView,
  HqTaskLimitsView,
} from "@t3tools/shared/hqIntake";

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

/** What the Slack card says while Slack's events are refused for their signature. */
export const SLACK_SIGNATURE_REFUSED =
  "Slack's messages are refused: the signing secret does not match. Replace it.";

/**
 * Whether Slack's events are refused for their signature now: the last refusal is later than the
 * last event HQ took. ISO instants of one shape compare as text.
 */
export function slackSignatureRefused(
  view: Pick<HqSlackView, "connected" | "eventsRefusedAt" | "eventsAcceptedAt">,
): boolean {
  const refused = view.eventsRefusedAt ?? null;
  if (!view.connected || refused === null) return false;
  const accepted = view.eventsAcceptedAt ?? null;
  return accepted === null || refused > accepted;
}

const inviteWords = (bot: string | null) => `Invite @${bot ?? "Mate"} to a channel first.`;

/** What an application's Slack channel is picked from: the bot's channels, or where to start. */
export function slackChannelChoices(
  held: HqSlackChannels,
):
  | { readonly kind: "channels"; readonly channels: HqSlackChannels["channels"] }
  | { readonly kind: "none"; readonly words: string } {
  return held.channels.length === 0
    ? { kind: "none", words: inviteWords(held.bot) }
    : { kind: "channels", channels: held.channels };
}

/** Where the bot is, in Settings: its channels, or that it is in none yet. */
export function slackChannelsLine(held: HqSlackChannels): string {
  const names = held.channels.map((channel) => `#${channel.name}`);
  if (names.length === 0) return inviteWords(held.bot);
  if (names.length === 1) return `In ${names[0]}.`;
  return `In ${names.slice(0, -1).join(", ")} and ${names.at(-1)}.`;
}

/** Whether a connected Slack's Replace is pressable: a key typed, and every one typed holds. */
export function replaceKeysReady(botToken: string, signingSecret: string): boolean {
  const typed = (
    [
      ["slack-bot-token", botToken],
      ["slack-signing-secret", signingSecret],
    ] as const
  ).filter(([, value]) => value.trim() !== "");
  return typed.length > 0 && connectKeysReady(typed);
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
    case "github-disconnect":
      return "Disconnecting…";
    case "github-manifest":
      return "Opening GitHub…";
    case "webhook-make":
    case "schedule-make":
      return "Making…";
    case "webhook-delete":
    case "schedule-delete":
      return "Deleting…";
    case "channel-stop":
    case "task-stop":
      return "Stopping…";
    case "channel":
    case "discord-allow":
    case "task-limits":
      return "Saving…";
  }
}

/**
 * What the organization's automated Mates spent this month, against its monthly budget; `null`
 * where HQ does not say (an older HQ).
 */
export function budgetLine(limits: HqTaskLimitsView): string | null {
  const spent = limits.spentThisMonthUsd;
  if (spent === undefined) return null;
  const said = `$${spent.toFixed(2)}`;
  const budget = limits.monthlyBudgetUsd;
  if (budget == null) return `No monthly budget. ${said} spent this month.`;
  return spent >= budget
    ? `${said} of ${dollars(budget)} spent this month: no task starts until next month or a higher budget.`
    : `${said} of ${dollars(budget)} spent this month.`;
}

/** A model's price as Settings says it: "$0.15 in · $0.50 out per million tokens". */
export function modelPriceWords(offer: AutomatedModel): string {
  const { input, output } = offer.usdPerMillion;
  return `$${input.toFixed(2)} in · $${output.toFixed(2)} out per million tokens`;
}

const BUDGET_MAX = 1_000_000;
const BUDGET_WORDS = "A budget is an amount above $0 and at most $1,000,000, or empty for none.";

/** The monthly budget as typed: an amount up to $1,000,000, or none. */
export function readBudget(
  typed: string,
): { readonly budgetUsd: number | null } | { readonly error: string } {
  const text = typed.trim();
  if (text === "") return { budgetUsd: null };
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0 || amount > BUDGET_MAX)
    return { error: BUDGET_WORDS };
  return { budgetUsd: amount };
}

/** A write's refusal, or its lost answer, in HQ's words; nothing otherwise. */
export function taskSourceProblem(action: AutomationAction<string>): string | null {
  return action.kind === "failed" || action.kind === "unresolved" ? action.words : null;
}

/** HQ's caps on the limits (`mate-hq apps/hq/src/taskLimits.ts`): said here before anything is sent. */
const MINUTES_MAX = 1440;
const COST_MAX = 10_000;
const MINUTES_WORDS = "Minutes are a whole number from 1 to 1,440.";
const COST_WORDS = "Cost is an amount above $0 and at most $10,000, or empty for none.";

/** The limits as typed: minutes a whole number from 1 to 1,440, cost up to $10,000 or none. */
export function readLimits(
  minutes: string,
  cost: string,
): { readonly limits: HqTaskLimitsView } | { readonly error: string } {
  const typedMinutes = minutes.trim();
  const whole = Number(typedMinutes);
  if (!/^\d+$/u.test(typedMinutes) || whole < 1 || whole > MINUTES_MAX)
    return { error: MINUTES_WORDS };
  const typedCost = cost.trim();
  if (typedCost === "") return { limits: { minutes: whole, costUsd: null } };
  const amount = Number(typedCost);
  if (!Number.isFinite(amount) || amount <= 0 || amount > COST_MAX) return { error: COST_WORDS };
  return { limits: { minutes: whole, costUsd: amount } };
}

/** The Discord allowlist after one ID added or removed, as HQ takes it: whole, each once. */
export function allowlistAfter(
  held: ReadonlyArray<string>,
  change: { readonly add: string } | { readonly remove: string },
): { readonly userIds: ReadonlyArray<string> } | { readonly error: string } {
  if ("remove" in change) return { userIds: held.filter((id) => id !== change.remove) };
  const id = change.add.trim();
  // As HQ takes it (`mate-hq apps/hq/src/discord.ts`): a snowflake of up to 20 digits.
  if (!/^\d{1,20}$/u.test(id))
    return { error: "A Discord user ID is a number of up to 20 digits." };
  return { userIds: held.includes(id) ? held : [...held, id] };
}

/** Slack's page that makes an app, from a manifest when one is given. */
export const SLACK_NEW_APP = "https://api.slack.com/apps?new_app=1";

/**
 * What HQ's manifest makes in one press: Slack's new-app page with the manifest whole, and what
 * the person sees of it before pressing — the addresses Slack sends its requests to (HQ's own) and
 * the scopes the bot asks for. `null` where the text is no manifest.
 */
export function slackManifestApp(text: string): {
  readonly createUrl: string;
  readonly requestUrls: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<string>;
} | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return null;
  const read = manifest as {
    readonly oauth_config?: { readonly scopes?: { readonly bot?: unknown } };
    readonly settings?: {
      readonly event_subscriptions?: { readonly request_url?: unknown };
      readonly interactivity?: { readonly request_url?: unknown };
    };
  };
  const strings = (values: ReadonlyArray<unknown>) =>
    values.filter((value): value is string => typeof value === "string" && value !== "");
  const bot = read.oauth_config?.scopes?.bot;
  return {
    createUrl: `${SLACK_NEW_APP}&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`,
    requestUrls: strings([
      read.settings?.event_subscriptions?.request_url,
      read.settings?.interactivity?.request_url,
    ]),
    scopes: Array.isArray(bot) ? strings(bot) : [],
  };
}

/** A key a connection's form takes, checked as HQ checks it (`mate-hq apps/hq/src/slack.ts`, `discord.ts`). */
export type ConnectKey =
  | "slack-bot-token"
  | "slack-signing-secret"
  | "discord-application-id"
  | "discord-public-key"
  | "discord-bot-token";

const CONNECT_KEYS: Record<ConnectKey, { readonly holds: RegExp; readonly words: string }> = {
  "slack-bot-token": { holds: /^xoxb-[\x21-\x7e]+$/u, words: "A bot token starts with xoxb-." },
  "slack-signing-secret": { holds: /^[\x21-\x7e]+$/u, words: "A signing secret has no spaces." },
  "discord-application-id": {
    holds: /^\d{1,20}$/u,
    words: "An application ID is a number of up to 20 digits.",
  },
  "discord-public-key": {
    holds: /^[0-9a-f]{64}$/iu,
    words: "A public key is 64 characters, 0–9 and a–f.",
  },
  "discord-bot-token": { holds: /^[\x21-\x7e]+$/u, words: "A bot token has no spaces." },
};

/** What is wrong with a key as typed; nothing while it is empty or holds. */
export function connectKeyProblem(key: ConnectKey, typed: string): string | null {
  const text = typed.trim();
  if (text === "") return null;
  return CONNECT_KEYS[key].holds.test(text) ? null : CONNECT_KEYS[key].words;
}

/** Whether every key is typed and holds: Connect is pressable. */
export function connectKeysReady(keys: ReadonlyArray<readonly [ConnectKey, string]>): boolean {
  return keys.every(
    ([key, typed]) => typed.trim() !== "" && connectKeyProblem(key, typed) === null,
  );
}
