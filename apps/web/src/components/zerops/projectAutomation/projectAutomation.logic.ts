/**
 * A project's Automation section, in words: its pool of automated Mates — each with what it is
 * on — and the sources its tasks come from, one row each, from what is read of them.
 */
import type { SettingValue } from "@t3tools/client-runtime/data";
import { couldntRead } from "@t3tools/client-runtime/zerops/hq";
import type {
  HqChannelView,
  HqScheduleRule,
  HqScheduleView,
  HqSlackChannels,
} from "@t3tools/shared/hqIntake";
import type { HqNavigationIntake } from "@t3tools/shared/hqStream";

import type { AutomatedKeyState } from "~/zerops/automatedMate.logic";

import { slackChannelChoices } from "../../settings/taskSourcesSettings.logic";
import { mateAutomatedLine, type MateAutomationLine } from "../SidebarMateRow.logic";

/** What an automated Mate of the pool is on, as its row in the menu says it. */
export function poolMateLine(automation: MateAutomationLine, working: boolean): string {
  return mateAutomatedLine(automation, working ? "working" : "idle").text;
}

/** A kind of source a project takes tasks from. */
export type SourceKind = "github" | "slack" | "discord" | "webhook" | "schedule";

/** The source kinds a project can take tasks from, in the words *Add* offers them in. */
export const SOURCE_KINDS: ReadonlyArray<{ readonly kind: SourceKind; readonly label: string }> = [
  { kind: "github", label: "GitHub issues" },
  { kind: "slack", label: "Slack channel" },
  { kind: "discord", label: "Discord channel" },
  { kind: "webhook", label: "Webhook" },
  { kind: "schedule", label: "Schedule" },
];

/** What every source's row says. */
interface SourceWords {
  readonly key: string;
  /** What it is: "GitHub issues labelled", "#support", "2 webhooks", a schedule's name. */
  readonly title: string;
  /** Where or when: its repository, "Slack", "Every Monday 09:00"; `null` where its title says all. */
  readonly detail: string | null;
  /** How many of its tasks wait for a Mate ("1 waiting"); `null` where none do, or it does not say. */
  readonly meta: string | null;
}

/** One source's row: what it is, where or when, and the form its press opens. */
export type SourceRow =
  | (SourceWords & {
      readonly kind: "github";
      /** The label its issues carry: a real name, said after its title. */
      readonly label: string;
    })
  | (SourceWords & { readonly kind: "webhook" })
  | (SourceWords & {
      readonly kind: "slack" | "discord";
      /** The organization's connection to it is missing: it takes no tasks until connected. */
      readonly disconnected: boolean;
    })
  | (SourceWords & { readonly kind: "schedule"; readonly id: string })
  /** A source whose read failed: HQ's words as its title, and *Try again*. */
  | (SourceWords & {
      readonly kind: "failed";
      readonly source: Exclude<SourceKind, "github">;
    });

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Every Monday 09:00": when a schedule runs, its time zone left to its form. */
export function scheduleWhen(rule: HqScheduleRule): string {
  const when =
    rule.every === "day"
      ? "Every day"
      : rule.every === "weekday"
        ? "Every weekday"
        : `Every ${DAYS[rule.day ?? 1] ?? "Monday"}`;
  return `${when} ${rule.at}`;
}

export interface SourceReads {
  /** HQ's navigation's intake: `undefined` while not read, `null` where none. */
  readonly intake: HqNavigationIntake | null | undefined;
  readonly slack: SettingValue<{ readonly channel: HqChannelView | null }>;
  readonly discord: SettingValue<{ readonly channel: HqChannelView | null }>;
  readonly webhooks: SettingValue<ReadonlyArray<{ readonly id: string }>>;
  readonly schedules: SettingValue<ReadonlyArray<HqScheduleView>>;
  /** Whether the organization has Slack / Discord connected; `undefined` while not known. */
  readonly slackConnected: boolean | undefined;
  readonly discordConnected: boolean | undefined;
}

const NOT_YET = new Set(["unread", "reading"]);

/**
 * The sources a project takes tasks from, one row each, whether any is still being read, and
 * whether any is refused to the reader (`withheld`): then what is shown is not every source. A
 * source refused to the reader, or one this HQ predates, has no row; one whose read failed says so.
 */
export function sourceRows(reads: SourceReads): {
  readonly rows: ReadonlyArray<SourceRow>;
  readonly reading: boolean;
  readonly withheld: boolean;
} {
  const rows: Array<SourceRow> = [];
  const { intake } = reads;
  if (intake != null)
    rows.push({
      key: "github",
      kind: "github",
      title: "GitHub issues labelled",
      label: intake.label,
      detail: intake.repo,
      meta: intake.waiting > 0 ? `${String(intake.waiting)} waiting` : null,
    });
  const channel = (
    kind: "slack" | "discord",
    setting: SourceReads["slack"],
    connected: boolean | undefined,
  ) => {
    if (setting.state === "failed")
      rows.push({
        key: `failed:${kind}`,
        kind: "failed",
        source: kind,
        title: couldntRead(`its ${kind === "slack" ? "Slack" : "Discord"} channel`, setting.words),
        detail: null,
        meta: null,
      });
    if (setting.state !== "known" || setting.held.channel === null) return;
    rows.push({
      key: kind,
      kind,
      title: `#${setting.held.channel.channel}`,
      detail: kind === "slack" ? "Slack" : "Discord",
      meta: null,
      disconnected: connected === false,
    });
  };
  channel("slack", reads.slack, reads.slackConnected);
  channel("discord", reads.discord, reads.discordConnected);
  if (reads.webhooks.state === "failed")
    rows.push({
      key: "failed:webhook",
      kind: "failed",
      source: "webhook",
      title: couldntRead("its webhooks", reads.webhooks.words),
      detail: null,
      meta: null,
    });
  if (reads.webhooks.state === "known" && reads.webhooks.held.length > 0) {
    const count = reads.webhooks.held.length;
    rows.push({
      key: "webhook",
      kind: "webhook",
      title: count === 1 ? "1 webhook" : `${String(count)} webhooks`,
      detail: null,
      meta: null,
    });
  }
  if (reads.schedules.state === "failed")
    rows.push({
      key: "failed:schedule",
      kind: "failed",
      source: "schedule",
      title: couldntRead("its schedules", reads.schedules.words),
      detail: null,
      meta: null,
    });
  if (reads.schedules.state === "known")
    for (const schedule of reads.schedules.held)
      rows.push({
        key: `schedule:${schedule.id}`,
        kind: "schedule",
        id: schedule.id,
        title: schedule.name,
        detail: scheduleWhen(schedule.rule),
        meta: null,
      });
  const reading =
    intake === undefined ||
    [reads.slack, reads.discord, reads.webhooks, reads.schedules].some((setting) =>
      NOT_YET.has(setting.state),
    );
  const withheld = [reads.slack, reads.discord, reads.webhooks, reads.schedules].some(
    (setting) => setting.state === "withheld",
  );
  return { rows, reading, withheld };
}

/**
 * What a channel's form says in place of itself where the organization has not connected the app
 * it needs: where to connect it. `null` once connected, or while that is not known.
 */
export function connectionMissing(
  kind: SourceKind,
  connected: { readonly slack: boolean | undefined; readonly discord: boolean | undefined },
): string | null {
  if (kind === "slack" && connected.slack === false)
    return "Slack isn't connected to your organization yet. Connect it in Settings › Automation, then pick a channel here.";
  if (kind === "discord" && connected.discord === false)
    return "Discord isn't connected to your organization yet. Connect it in Settings › Automation, then pick a channel here.";
  return null;
}

/**
 * How a project's page shows its Automation section: to an Owner or Admin always — they set it up
 * there — and where HQ predates automated Mates, in its place, that HQ needs updating (never
 * painted, then taken away); to anyone else once it holds something to read: an automated Mate,
 * or a source.
 */
export function automationSection(input: {
  readonly admin: boolean;
  readonly key: AutomatedKeyState;
  readonly pool: number;
  readonly sources: number;
}): "shown" | "update" | "hidden" {
  if (input.admin) return input.key === "unsupported" ? "update" : "shown";
  if (input.key === "unsupported") return "hidden";
  return input.pool > 0 || input.sources > 0 ? "shown" : "hidden";
}

/**
 * Where a task's Stop stands on its row: at rest; asking whether to, in the row; under way; or
 * refused, in HQ's words, on the row it was pressed on.
 */
export type RowPress =
  | { readonly kind: "idle" }
  | { readonly kind: "asking" }
  | { readonly kind: "working" }
  | { readonly kind: "refused"; readonly words: string };

export function sourceRowPress(input: {
  readonly key: string;
  /** The row whose Stop asks now; `null`: none. */
  readonly asking: string | null;
  /** The row whose Stop was confirmed last; `null`: none. */
  readonly pressed: string | null;
  /** Where that row's stop stands at HQ. */
  readonly action:
    | { readonly kind: "idle" | "working" | "done" }
    | { readonly kind: "failed" | "unresolved"; readonly words: string };
}): RowPress {
  if (input.asking === input.key) return { kind: "asking" };
  if (input.pressed !== input.key) return { kind: "idle" };
  const { action } = input;
  if (action.kind === "working") return { kind: "working" };
  if (action.kind === "failed" || action.kind === "unresolved")
    return { kind: "refused", words: action.words };
  return { kind: "idle" };
}

/**
 * How a project's Slack channel is chosen: picked from the channels the bot is in, or its ID typed
 * — as the person asks, where the bot is in none yet (with where to start), or where the list is
 * not at hand. While the list is read, the picker's room waits.
 */
export function slackChannelForm(
  choices: SettingValue<HqSlackChannels>,
  typing: boolean,
):
  | { readonly kind: "pick"; readonly channels: HqSlackChannels["channels"] }
  | { readonly kind: "type"; readonly invite: string | null }
  | { readonly kind: "reading" } {
  if (choices.state === "unread" || choices.state === "reading")
    return typing ? { kind: "type", invite: null } : { kind: "reading" };
  if (choices.state !== "known") return { kind: "type", invite: null };
  const read = slackChannelChoices(choices.held);
  if (read.kind === "none") return { kind: "type", invite: read.words };
  return typing ? { kind: "type", invite: null } : { kind: "pick", channels: read.channels };
}
