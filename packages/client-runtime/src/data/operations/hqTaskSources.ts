/**
 * The settings' writes for where automated Mates take tasks from besides GitHub — the
 * organization's Slack app and Discord application, an application's channel on each, its
 * webhooks and schedules, and the limits on each task — which HQ answers at once. A token or a
 * signing secret is never part of the recorded intent: it goes to the executor alone
 * (`makeTaskSourceSettings`). Each shows done once a read of its setting started after HQ's
 * answer lands (`taskSourceSetting`). The organization's GitHub app is made and forgotten the same
 * way: the manifest HQ answers goes back to the screen that asked for it alone, never into a
 * record, since it binds GitHub's return to that one request.
 *
 * @module data/operations/hqTaskSources
 */
import type { HqScheduleRequest, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import type { TaskSourceSetting } from "../families/hqTaskSources.ts";
import type { OperationKind } from "./kind.ts";

/** A write, by what it changes; the setting it is read back in is `taskSourceWriteSetting`'s. */
export type TaskSourceWrite =
  /** The bot token and signing secret go to the executor alone. */
  | { readonly kind: "slack-connect" }
  | { readonly kind: "slack-disconnect" }
  /** The bot token goes to the executor alone; the id and the public key are not secret. */
  | { readonly kind: "discord-connect"; readonly applicationId: string; readonly publicKey: string }
  | { readonly kind: "discord-disconnect" }
  | { readonly kind: "discord-allow"; readonly userIds: ReadonlyArray<string> }
  | {
      readonly kind: "channel";
      readonly source: "slack" | "discord";
      readonly channelId: string;
    }
  | { readonly kind: "channel-stop"; readonly source: "slack" | "discord" }
  | { readonly kind: "webhook-make"; readonly name: string }
  | { readonly kind: "webhook-delete"; readonly webhookId: string }
  | { readonly kind: "schedule-make"; readonly request: HqScheduleRequest }
  | { readonly kind: "schedule-delete"; readonly scheduleId: string }
  | { readonly kind: "task-limits"; readonly limits: HqTaskLimitsView }
  /** One of an application's tasks stopped from its board. */
  | { readonly kind: "task-stop"; readonly taskId: string }
  /** HQ's manifest for the app goes to the screen that asked, never into the record. */
  | {
      readonly kind: "github-manifest";
      /** The GitHub organization to own it; `null`: the person's own account. */
      readonly owner: string | null;
      readonly name: string;
      readonly returnTo: string;
    }
  | { readonly kind: "github-disconnect" }
  /** HQ's install link goes to the screen that asked, never into the record: its state is one-time. */
  | { readonly kind: "github-install"; readonly returnTo: string }
  /** HQ acts on a waiting installation's repositories. */
  | { readonly kind: "github-accept"; readonly installationId: number }
  /** GitHub suspends the installation. */
  | { readonly kind: "github-suspend"; readonly installationId: number }
  /** GitHub resumes an installation the app suspended. */
  | { readonly kind: "github-resume"; readonly installationId: number };

declare module "../model.ts" {
  interface OperationIntents {
    readonly "task-source": {
      readonly orgId: string;
      /** The application it is written for; `null` for the organization's own. */
      readonly appId: string | null;
      readonly write: TaskSourceWrite;
    };
  }
}

/** The setting a write is read back in. */
export function taskSourceWriteSetting(write: TaskSourceWrite): TaskSourceSetting {
  switch (write.kind) {
    case "slack-connect":
    case "slack-disconnect":
      return "hqSlack";
    case "discord-connect":
    case "discord-disconnect":
    case "discord-allow":
      return "hqDiscord";
    case "channel":
    case "channel-stop":
      return write.source === "slack" ? "hqAppSlack" : "hqAppDiscord";
    case "webhook-make":
    case "webhook-delete":
      return "hqAppWebhooks";
    case "schedule-make":
    case "schedule-delete":
      return "hqAppSchedules";
    case "task-limits":
      return "hqTaskLimits";
    case "task-stop":
      return "hqAppTasks";
    case "github-manifest":
    case "github-disconnect":
    case "github-install":
    case "github-accept":
    case "github-suspend":
    case "github-resume":
      return "hqGithub";
  }
}

export const taskSource: OperationKind<"task-source"> = {
  kind: "task-source",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};

export const HQ_TASK_SOURCE_KINDS = [taskSource] as const;
