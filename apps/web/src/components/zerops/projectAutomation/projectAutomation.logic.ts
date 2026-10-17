/**
 * A project's Automation section, in words: its pool of automated Mates — each with what it is
 * on — and the sources its tasks come from, one row each, from what is read of them.
 */
import type { SettingValue } from "@t3tools/client-runtime/data";
import type { HqChannelView, HqScheduleRule, HqScheduleView } from "@t3tools/shared/hqIntake";
import type { HqNavigationIntake } from "@t3tools/shared/hqStream";

import type { AutomatedKeyState } from "~/zerops/automatedMate.logic";

import {
  mateAutomatedLine,
  tasksWaitingWords,
  type MateAutomationLine,
} from "../SidebarMateRow.logic";

/** What an automated Mate of the pool is on, as its row in the menu says it. */
export function poolMateLine(automation: MateAutomationLine, working: boolean): string {
  return mateAutomatedLine(automation, working ? "working" : "idle").text;
}

/** A kind of source a project takes tasks from. */
export type SourceKind = "github" | "slack" | "discord" | "webhook" | "schedule";

/** The source kinds *Take tasks from…* offers, in its menu's words. */
export const SOURCE_KINDS: ReadonlyArray<{ readonly kind: SourceKind; readonly label: string }> = [
  { kind: "github", label: "GitHub issues" },
  { kind: "slack", label: "Slack channel" },
  { kind: "discord", label: "Discord channel" },
  { kind: "webhook", label: "Webhook" },
  { kind: "schedule", label: "Schedule" },
];

/** One source's row: what it is in words, the form its Edit opens, and what its Stop does. */
export type SourceRow =
  | {
      readonly key: string;
      readonly kind: "github" | "webhook";
      readonly words: string;
    }
  | {
      readonly key: string;
      readonly kind: "slack" | "discord";
      readonly words: string;
      /** The organization's connection to it is missing: it takes no tasks until connected. */
      readonly disconnected: boolean;
    }
  | {
      readonly key: string;
      readonly kind: "schedule";
      readonly id: string;
      readonly words: string;
    }
  /** A source whose read failed: HQ's words, and *Read again*. */
  | {
      readonly key: string;
      readonly kind: "failed";
      readonly source: Exclude<SourceKind, "github">;
      readonly words: string;
    };

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
  if (intake != null) {
    const waiting = tasksWaitingWords(intake.waiting);
    rows.push({
      key: "github",
      kind: "github",
      words: [`GitHub issues labelled “${intake.label}”`, intake.repo, waiting]
        .filter((part) => part !== undefined)
        .join(" · "),
    });
  }
  const channel = (
    kind: "slack" | "discord",
    setting: SourceReads["slack"],
    connected: boolean | undefined,
  ) => {
    if (setting.state === "failed")
      rows.push({ key: `failed:${kind}`, kind: "failed", source: kind, words: setting.words });
    if (setting.state !== "known" || setting.held.channel === null) return;
    rows.push({
      key: kind,
      kind,
      words: `#${setting.held.channel.channel} on ${kind === "slack" ? "Slack" : "Discord"}`,
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
      words: reads.webhooks.words,
    });
  if (reads.webhooks.state === "known" && reads.webhooks.held.length > 0) {
    const count = reads.webhooks.held.length;
    rows.push({
      key: "webhook",
      kind: "webhook",
      words: count === 1 ? "1 webhook" : `${String(count)} webhooks`,
    });
  }
  if (reads.schedules.state === "failed")
    rows.push({
      key: "failed:schedule",
      kind: "failed",
      source: "schedule",
      words: reads.schedules.words,
    });
  if (reads.schedules.state === "known")
    for (const schedule of reads.schedules.held)
      rows.push({
        key: `schedule:${schedule.id}`,
        kind: "schedule",
        id: schedule.id,
        words: `${scheduleWhen(schedule.rule)} · ${schedule.name}`,
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
 * Whether a project's page shows its Automation section: never where HQ predates automated Mates;
 * to an Owner or Admin always — they set it up there — and to anyone else once it holds something
 * to read: an automated Mate, or a source.
 */
export function automationShown(input: {
  readonly admin: boolean;
  readonly key: AutomatedKeyState;
  readonly pool: number;
  readonly sources: number;
}): boolean {
  if (input.key === "unsupported") return false;
  return input.admin || input.pool > 0 || input.sources > 0;
}

/**
 * Where a source row's Stop (or a schedule's Remove) stands: at rest; asking whether to, on the
 * row; under way; or refused, in HQ's words, on the row it was pressed on.
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
  /** Where the write of that row's source stands. */
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

/** What a row's Stop asks, says on its press, and says while it works. */
export function stopWords(kind: "github" | "slack" | "discord" | "schedule"): {
  readonly ask: string;
  readonly verb: string;
  readonly working: string;
} {
  if (kind === "schedule")
    return { ask: "Remove this schedule and its brief?", verb: "Remove", working: "Removing…" };
  if (kind === "github")
    return { ask: "Stop taking GitHub issues?", verb: "Stop", working: "Stopping…" };
  return { ask: "Stop taking tasks from this channel?", verb: "Stop", working: "Stopping…" };
}
