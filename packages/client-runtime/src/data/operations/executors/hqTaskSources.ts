/**
 * HQ as the owner of the settings' writes for Slack, Discord, webhooks, schedules and task limits.
 * HQ keeps no request id for them: a lost answer is read in the setting once it is read again. The
 * tokens and secrets typed for a connection come from the screen they were typed into, for their
 * own request only, and are gone once sent: never retried, never in a refusal's words.
 */
import * as Effect from "effect/Effect";
import type { HqGithubManifestView } from "@t3tools/shared/hqGithub";
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import { HqError, type HqApi } from "../../../zerops/hq/client.ts";
import type { OperationExecutor } from "../coordinator.ts";

export type TaskSourceWrites = Pick<
  HqApi,
  | "connectSlack"
  | "disconnectSlack"
  | "connectDiscord"
  | "disconnectDiscord"
  | "setAppChannel"
  | "stopAppChannel"
  | "makeWebhook"
  | "deleteWebhook"
  | "makeSchedule"
  | "deleteSchedule"
  | "setTaskLimits"
  | "stopAppTask"
  | "githubManifest"
  | "githubForget"
  | "githubInstall"
  | "githubAcceptInstallation"
  | "githubSuspendInstallation"
  | "githubResumeInstallation"
>;

/** The secrets typed for one connection, by their field's name. */
export type TypedSecrets = Readonly<Record<string, string>>;

/**
 * HQ's refusal of an install link, an Accept or a Suspend in words: an installation or app HQ no
 * longer holds is gone, and an app
 * whose key GitHub no longer takes is gone. `undefined`: HQ's own words stand.
 */
function installationRefusal(cause: HqError, of: "installation" | "app"): string | undefined {
  if (cause.code === "not_found")
    return of === "app"
      ? "That GitHub app is no longer in this organization."
      : "That installation is gone from GitHub.";
  if (of === "app" && cause.reason === "github_unavailable")
    return "GitHub didn't take this app's key. Check the app on GitHub, or remove it and add another.";
  return undefined;
}

/**
 * HQ's refusal of a task's stop in words: a person who is no Owner or Admin may not, and a task
 * that ended meanwhile has nothing to stop.
 * `undefined`: HQ's own words stand.
 */
function taskStopRefusal(cause: HqError): string | undefined {
  if (cause.status === 403) return "Only an Owner or Admin can stop a task.";
  if (cause.reason === "task_not_found") return "That task has ended already.";
  return undefined;
}

export function makeTaskSourceExecutor(options: {
  readonly api: TaskSourceWrites;
  readonly current: () => boolean;
  /** The secrets typed for this request, moved out: `undefined` once taken, or never given. */
  readonly takeSecrets: (requestId: string) => TypedSecrets | undefined;
  /** HQ's answer to a webhook made: its URL and its secret, shown this once. */
  readonly revealed: (requestId: string, view: HqWebhookView) => void;
  /** HQ's manifest for the organization's GitHub app, for the screen that asked for it alone. */
  readonly manifested: (requestId: string, view: HqGithubManifestView) => void;
  /** HQ's install link for the organization's GitHub app, for the screen that asked for it alone. */
  readonly linked: (requestId: string, url: string) => void;
}): OperationExecutor {
  const refused = (message: string) => ({ outcome: "definitive-refusal" as const, message });
  return {
    isCurrent: options.current,
    submit: (requestId, intent) =>
      Effect.gen(function* () {
        if (!options.current())
          return yield* Effect.fail(refused("This Zerops sign-in has ended."));
        if (intent.kind !== "task-source")
          return yield* Effect.fail(refused("This action is unavailable."));
        const { api } = options;
        const { write } = intent;
        const appId = intent.appId ?? "";
        // A connection's secrets, taken once whatever the call: never kept past it.
        const secrets =
          write.kind === "slack-connect" || write.kind === "discord-connect"
            ? options.takeSecrets(requestId)
            : undefined;
        const call = (): Promise<unknown> => {
          switch (write.kind) {
            case "slack-connect": {
              // Both to connect; once connected, either alone replaces the one HQ holds.
              const botToken = secrets?.botToken;
              const signingSecret = secrets?.signingSecret;
              if (botToken === undefined && signingSecret === undefined)
                return Promise.reject(refused("Enter the token and the secret again."));
              return api.connectSlack({
                ...(botToken === undefined ? {} : { botToken }),
                ...(signingSecret === undefined ? {} : { signingSecret }),
              });
            }
            case "slack-disconnect":
              return api.disconnectSlack();
            case "discord-connect": {
              const botToken = secrets?.botToken;
              if (botToken === undefined) return Promise.reject(refused("Enter the token again."));
              return api.connectDiscord({
                applicationId: write.applicationId,
                publicKey: write.publicKey,
                botToken,
              });
            }
            case "discord-disconnect":
              return api.disconnectDiscord();
            case "channel":
              return api.setAppChannel(appId, write.source, { channelId: write.channelId });
            case "channel-stop":
              return api.stopAppChannel(appId, write.source);
            case "webhook-make":
              return api.makeWebhook(appId, { name: write.name }).then((view) => {
                options.revealed(requestId, view);
              });
            case "webhook-delete":
              return api.deleteWebhook(appId, write.webhookId);
            case "schedule-make":
              return api.makeSchedule(appId, write.request);
            case "schedule-delete":
              return api.deleteSchedule(appId, write.scheduleId);
            case "task-limits":
              return api.setTaskLimits(write.limits);
            case "task-stop":
              return api.stopAppTask(appId, write.taskId);
            case "github-manifest":
              return api
                .githubManifest({
                  owner: write.owner,
                  name: write.name,
                  returnTo: write.returnTo,
                })
                .then((view) => {
                  options.manifested(requestId, view);
                });
            case "github-forget":
              return api.githubForget(write.githubAppId);
            case "github-install":
              return api
                .githubInstall(write.githubAppId, { returnTo: write.returnTo })
                .then((view) => {
                  options.linked(requestId, view.url);
                });
            case "github-accept":
              return api.githubAcceptInstallation(write.installationId);
            case "github-suspend":
              return api.githubSuspendInstallation(write.installationId);
            case "github-resume":
              return api.githubResumeInstallation(write.installationId);
          }
        };
        const pending = call();
        const typed = Object.values(secrets ?? {}).filter((value) => value.length > 0);
        yield* Effect.tryPromise({
          try: () => pending,
          catch: (cause) =>
            typeof cause === "object" && cause !== null && "outcome" in cause
              ? (cause as ReturnType<typeof refused>)
              : cause instanceof HqError && cause.kind === "refused"
                ? // HQ's refusal is said, never words that may echo what was typed.
                  refused(
                    (write.kind === "task-stop"
                      ? taskStopRefusal(cause)
                      : write.kind === "github-install" || write.kind === "github-forget"
                        ? installationRefusal(cause, "app")
                        : write.kind === "github-accept" ||
                            write.kind === "github-suspend" ||
                            write.kind === "github-resume"
                          ? installationRefusal(cause, "installation")
                          : undefined) ??
                      (typed.some((value) => cause.message.includes(value))
                        ? "HQ did not take what was entered."
                        : cause.message),
                  )
                : {
                    outcome: "uncertain-acceptance" as const,
                    message: "HQ may have taken this change. Check it before trying again.",
                  },
        });
        if (!options.current())
          return yield* Effect.fail({
            outcome: "uncertain-acceptance",
            message: "The account changed before HQ answered.",
          } as const);
        return {
          requestId,
          operationId: requestId,
          executor: "hq",
          handles: [intent.appId ?? intent.orgId],
          affected: [],
          acceptance: { kind: "accepted" },
          outcome: { kind: "succeeded", evidence: "HQ answered this change." },
        };
      }),
  };
}
