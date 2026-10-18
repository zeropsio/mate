/**
 * Where automated Mates take tasks from besides GitHub, as the settings read it: the
 * organization's Slack app and Discord application (connected or not, never a token), the
 * manifest a Slack app is made from, the limits on each task; and, per application, the channel
 * it takes tasks from on each, its signed webhooks (never a secret), its schedules, and the tasks
 * its automated Mates took (its Automation board). Each is read
 * while a screen demands it. A webhook's secret, which HQ shows only as it is made, is held only
 * while the screen that made it stays open (`hqWebhookReveal`). The organization's GitHub app
 * (connected or not, never its key) is read the same way, beside them in Settings › Automation.
 */
import type {
  HqAppTask,
  HqChannelView,
  HqDiscordView,
  HqScheduleView,
  HqSlackView,
  HqTaskLimitsView,
  HqWebhookView,
} from "@t3tools/shared/hqIntake";
import type { HqGithubView } from "@t3tools/shared/hqGithub";
import type { LinkKey, ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqSlack: HqSlackView;
    /** The manifest's JSON, as the person copies it into Slack. */
    readonly hqSlackManifest: string;
    readonly hqDiscord: HqDiscordView;
    readonly hqTaskLimits: HqTaskLimitsView;
    /** The organization's GitHub app: where it is installed, never its key. */
    readonly hqGithub: HqGithubView;
    readonly hqAppSlack: { readonly channel: HqChannelView | null };
    readonly hqAppDiscord: { readonly channel: HqChannelView | null };
    /** Never with a secret: HQ shows one only as the webhook is made. */
    readonly hqAppWebhooks: ReadonlyArray<HqWebhookView>;
    readonly hqAppSchedules: ReadonlyArray<HqScheduleView>;
    /**
     * Its tasks: queued, at work, and the latest that ended. Read again while shown as HQ's
     * navigation says its automated Mates' tasks moved (`hqTaskBoardRefresh`): HQ streams no
     * board of its own.
     */
    readonly hqAppTasks: ReadonlyArray<HqAppTask>;
    /**
     * The latest write of this account's to one of them (a task's stop: to that task,
     * `taskStopRequestId`), by its request, and — once HQ answered
     * it — the last read started before that answer: the write shows done once a read started
     * after it lands. `null` until HQ answers.
     */
    readonly hqTaskSourceRequest: { readonly requestId: string; readonly after: number | null };
    /** The webhook made from this screen, with its secret, while the screen stays open. */
    readonly hqWebhookReveal: { readonly requestId: string; readonly view: HqWebhookView | null };
  }
}

export interface OrgSettingKey {
  readonly orgId: string;
}
export interface AppSettingKey {
  readonly orgId: string;
  readonly appId: string;
}

/** What is read per organization, and per application. */
export const ORG_SETTINGS = [
  "hqSlack",
  "hqSlackManifest",
  "hqDiscord",
  "hqTaskLimits",
  "hqGithub",
] as const;
export const APP_SETTINGS = [
  "hqAppSlack",
  "hqAppDiscord",
  "hqAppWebhooks",
  "hqAppSchedules",
  "hqAppTasks",
] as const;
export type OrgSetting = (typeof ORG_SETTINGS)[number];
export type AppSetting = (typeof APP_SETTINGS)[number];
export type TaskSourceSetting = OrgSetting | AppSetting;
export type SettingKeyOf<F extends TaskSourceSetting> = F extends OrgSetting
  ? OrgSettingKey
  : AppSettingKey;

const SUFFIX: Readonly<Record<TaskSourceSetting, string>> = {
  hqSlack: "slack",
  hqSlackManifest: "slack-manifest",
  hqDiscord: "discord",
  hqTaskLimits: "task-limits",
  hqGithub: "github",
  hqAppSlack: "app-slack",
  hqAppDiscord: "app-discord",
  hqAppWebhooks: "app-webhooks",
  hqAppSchedules: "app-schedules",
  hqAppTasks: "app-tasks",
};

export const settingId = (key: OrgSettingKey | AppSettingKey): string =>
  "appId" in key ? JSON.stringify([key.orgId, key.appId]) : JSON.stringify([key.orgId]);
export const settingScope = (family: TaskSourceSetting, key: OrgSettingKey | AppSettingKey) =>
  `hq:${key.orgId}:${SUFFIX[family]}:${settingId(key)}` satisfies ScopeKey;
/** The link a setting is read on: its fault is the read's own. */
export const settingLink = (family: TaskSourceSetting, key: OrgSettingKey | AppSettingKey) =>
  `hq:${SUFFIX[family]}-${encodeURIComponent(settingId(key))}` satisfies LinkKey;

/** The request record's id: which setting it was written to. */
export const settingRequestId = (
  family: TaskSourceSetting,
  key: OrgSettingKey | AppSettingKey,
): string => JSON.stringify([family, settingId(key)]);
export const settingRequestScope = (
  family: TaskSourceSetting,
  key: OrgSettingKey | AppSettingKey,
): ScopeKey => `hq:${key.orgId}:task-source-request:${settingRequestId(family, key)}`;
/**
 * A stop of one of an application's tasks has a request record of its own, by the task: a second
 * stop never hides where the first stands, and every surface showing the task reads the same one.
 */
export const taskStopRequestId = (key: AppSettingKey, taskId: string): string =>
  JSON.stringify(["hqAppTasks", settingId(key), "stop", taskId]);
export const taskStopRequestScope = (key: AppSettingKey, taskId: string): ScopeKey =>
  `hq:${key.orgId}:task-source-request:${taskStopRequestId(key, taskId)}`;
export const webhookRevealScope = (key: AppSettingKey): ScopeKey =>
  `hq:${key.orgId}:webhook-reveal:${settingId(key)}`;

const detail = <F extends TaskSourceSetting | "hqTaskSourceRequest" | "hqWebhookReveal">(
  family: F,
  suffix: string,
): FamilySpec<F> => ({
  family,
  authority: "hq",
  scope: { source: "hq", suffix, leaving: "removed", demand: "detail", mode: "once" },
});

export const hqSlackFamily = detail("hqSlack", SUFFIX.hqSlack);
export const hqSlackManifestFamily = detail("hqSlackManifest", SUFFIX.hqSlackManifest);
export const hqDiscordFamily = detail("hqDiscord", SUFFIX.hqDiscord);
export const hqTaskLimitsFamily = detail("hqTaskLimits", SUFFIX.hqTaskLimits);
export const hqGithubFamily = detail("hqGithub", SUFFIX.hqGithub);
export const hqAppSlackFamily = detail("hqAppSlack", SUFFIX.hqAppSlack);
export const hqAppDiscordFamily = detail("hqAppDiscord", SUFFIX.hqAppDiscord);
export const hqAppWebhooksFamily = detail("hqAppWebhooks", SUFFIX.hqAppWebhooks);
export const hqAppSchedulesFamily = detail("hqAppSchedules", SUFFIX.hqAppSchedules);
export const hqAppTasksFamily = detail("hqAppTasks", SUFFIX.hqAppTasks);
export const hqTaskSourceRequestFamily = detail("hqTaskSourceRequest", "task-source-request");
export const hqWebhookRevealFamily = detail("hqWebhookReveal", "webhook-reveal");
