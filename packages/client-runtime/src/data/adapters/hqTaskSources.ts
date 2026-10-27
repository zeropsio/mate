/**
 * The settings for where automated Mates take tasks from besides GitHub, as the account holds
 * them: the organization's Slack app and Discord application, the limits on each task, and per
 * application its channel on each, its webhooks and its schedules — each read while a screen
 * demands it and again after each write of ours; the writes themselves, through their own
 * coordinator; and a webhook's secret, held while the screen that made it is open — HQ shows it
 * once, so closing that screen forgets it, and nothing else ever holds it.
 *
 * A token or a signing secret typed to connect Slack or Discord goes to the executor alone, for
 * its own request, and is gone once sent.
 */
import type { HqGithubManifestRequest, HqGithubManifestView } from "@t3tools/shared/hqGithub";
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import * as Effect from "effect/Effect";
import type { HqApi } from "../../zerops/hq/client.ts";
import {
  settingId,
  settingLink,
  settingRequestId,
  settingRequestScope,
  settingScope,
  taskStopRequestId,
  taskStopRequestScope,
  webhookRevealScope,
  type AppSetting,
  type AppSettingKey,
  type OrgSetting,
  type OrgSettingKey,
  type SettingKeyOf,
  type TaskSourceSetting,
} from "../families/hqTaskSources.ts";
import { makeOperations } from "../operations/coordinator.ts";
import {
  makeTaskSourceExecutor,
  type TaskSourceWrites,
  type TypedSecrets,
} from "../operations/executors/hqTaskSources.ts";
import { taskSourceWriteSetting, type TaskSourceWrite } from "../operations/hqTaskSources.ts";
import type { AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { commitOwn, makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";
import { appTasksSignature, orgTasksSignature } from "./hqTaskBoardRefresh.ts";

export type TaskSourceApi = TaskSourceWrites &
  Pick<
    HqApi,
    | "slack"
    | "slackManifest"
    | "slackChannels"
    | "discord"
    | "taskLimits"
    | "appChannel"
    | "webhooks"
    | "schedules"
    | "appTasks"
    | "github"
  >;

/** What an HQ that predates these settings is asked. */
export const TASK_SOURCES_UNSUPPORTED =
  "Update HQ to take tasks from Slack, Discord, webhooks and schedules.";
/** What an HQ that predates the organization's GitHub app is asked. */
export const GITHUB_UNSUPPORTED = "Update HQ to connect GitHub.";

/** A webhook's answer as a list holds it: never its secret. */
const withoutSecret = ({ secret: _secret, ...view }: HqWebhookView): HqWebhookView => view;

export function makeTaskSourceSettings(options: {
  readonly store: AccountStore;
  readonly api: TaskSourceApi;
  readonly makeId: () => string;
}) {
  const { store, api } = options;
  let closed = false;
  const reads = makeSettingsReads(store);

  function specOf<F extends TaskSourceSetting>(family: F, key: SettingKeyOf<F>): SettingRead<F>;
  function specOf(
    family: TaskSourceSetting,
    key: OrgSettingKey | AppSettingKey,
  ): SettingRead<TaskSourceSetting> {
    const appId = "appId" in key ? key.appId : "";
    const read = (): Promise<unknown> | undefined => {
      switch (family) {
        case "hqSlack":
          return api.slack?.();
        case "hqSlackManifest":
          return api.slackManifest?.().then((manifest) => JSON.stringify(manifest, null, 2));
        case "hqSlackChannels":
          return api.slackChannels?.();
        case "hqDiscord":
          return api.discord?.();
        case "hqTaskLimits":
          return api.taskLimits?.();
        case "hqGithub":
          return api.github?.();
        case "hqAppSlack":
          return api.appChannel?.(appId, "slack").then((channel) => ({ channel }));
        case "hqAppDiscord":
          return api.appChannel?.(appId, "discord").then((channel) => ({ channel }));
        case "hqAppWebhooks":
          return api.webhooks?.(appId).then((list) => list.map(withoutSecret));
        case "hqAppSchedules":
          return api.schedules?.(appId);
        case "hqAppTasks":
          return api.appTasks?.(appId);
      }
    };
    return {
      family,
      id: settingId(key),
      scope: settingScope(family, key),
      link: settingLink(family, key),
      read: read as SettingRead<TaskSourceSetting>["read"],
      unsupported: family === "hqGithub" ? GITHUB_UNSUPPORTED : TASK_SOURCES_UNSUPPORTED,
    };
  }

  // ── the task board and the month's spend, read again as navigation says tasks moved ─────────
  const following = new Map<string, { count: number; readonly stop: () => void }>();
  /** While `spec` is demanded, reads it again each time `signature` moves (`hqTaskBoardRefresh`). */
  const follow = (spec: SettingRead<TaskSourceSetting>, signature: () => string) => {
    const id = `${spec.family}:${spec.id}`;
    const held = following.get(id);
    if (held !== undefined) held.count++;
    else {
      let seen = signature();
      const stop = store.subscribe(() => {
        const next = signature();
        if (next === seen) return;
        seen = next;
        // A refused read (an HQ that predates it) waits for the person, never for navigation.
        if (streamOf(store.state(), spec.link).phase === "refused") return;
        reads.again(spec);
      });
      following.set(id, { count: 1, stop });
    }
    return () => {
      const entry = following.get(id);
      if (entry === undefined || --entry.count > 0) return;
      following.delete(id);
      entry.stop();
    };
  };
  const demandFollowed = (
    spec: SettingRead<TaskSourceSetting>,
    key: OrgSettingKey | AppSettingKey,
  ) => {
    const release = reads.demand(spec);
    const signature =
      spec.family === "hqAppTasks" && "appId" in key
        ? () => appTasksSignature(store.state(), key.orgId, key.appId)
        : spec.family === "hqTaskLimits"
          ? () => orgTasksSignature(store.state(), key.orgId)
          : null;
    if (signature === null) return release;
    const unfollow = follow(spec, signature);
    return () => {
      unfollow();
      release();
    };
  };

  // ── a webhook's answer, held while its screen is open ─────────────────────────────────────
  const views = new Map<string, number>();
  const epochs = new Map<string, number>();
  const revealedFor = new Map<string, { readonly key: AppSettingKey; readonly epoch: number }>();
  const publish = (key: AppSettingKey, requestId: string, view: HqWebhookView | null) => {
    if (!closed)
      commitOwn(store, "hqWebhookReveal", webhookRevealScope(key), settingId(key), {
        requestId,
        view,
      });
  };
  const forget = (key: AppSettingKey) => {
    const fact = store.state().facts.get(`hqWebhookReveal:${settingId(key)}`);
    if (fact?.content.kind === "value") {
      const held = fact.content.value as { readonly requestId: string; readonly view: unknown };
      if (held.view !== null) publish(key, held.requestId, null);
    }
  };

  // ── the writes ────────────────────────────────────────────────────────────────────────────
  const secrets = new Map<string, TypedSecrets>();
  /** HQ's manifest for the GitHub app, by the request that asked: taken by that request alone. */
  const manifests = new Map<string, HqGithubManifestView>();
  const operations = makeOperations({
    store,
    makeId: options.makeId,
    executors: {
      hq: makeTaskSourceExecutor({
        api,
        current: () => !closed,
        takeSecrets: (requestId) => {
          const typed = secrets.get(requestId);
          secrets.delete(requestId);
          return typed;
        },
        revealed: (requestId, view) => {
          const held = revealedFor.get(requestId);
          if (
            held !== undefined &&
            (views.get(settingId(held.key)) ?? 0) > 0 &&
            held.epoch === (epochs.get(settingId(held.key)) ?? 0)
          )
            publish(held.key, requestId, view);
        },
        manifested: (requestId, view) => {
          if (!closed) manifests.set(requestId, view);
        },
      }),
    },
  });

  const write = async (
    key: OrgSettingKey | AppSettingKey,
    change: TaskSourceWrite,
    typed?: TypedSecrets,
  ): Promise<string> => {
    const requestId = options.makeId();
    const family = taskSourceWriteSetting(change);
    // A task's stop is recorded by its task; every other write by the setting it changes.
    const stopOf = change.kind === "task-stop" && "appId" in key ? change.taskId : null;
    const scope =
      stopOf === null
        ? settingRequestScope(family, key)
        : taskStopRequestScope(key as AppSettingKey, stopOf);
    const id =
      stopOf === null
        ? settingRequestId(family, key)
        : taskStopRequestId(key as AppSettingKey, stopOf);
    const spec = specOf(family, key as never);
    if (typed !== undefined) secrets.set(requestId, typed);
    commitOwn(store, "hqTaskSourceRequest", scope, id, { requestId, after: null });
    if (change.kind === "webhook-make" && "appId" in key) {
      revealedFor.set(requestId, { key, epoch: epochs.get(settingId(key)) ?? 0 });
      publish(key, requestId, null);
    }
    try {
      await Effect.runPromise(
        operations.submit(
          {
            kind: "task-source",
            orgId: key.orgId,
            appId: "appId" in key ? key.appId : null,
            write: change,
          },
          requestId,
        ),
      );
      return requestId;
    } finally {
      secrets.delete(requestId);
      revealedFor.delete(requestId);
      if (!closed) {
        // The write shows once a read started after HQ's answer lands: the last started before.
        const latest = store.state().facts.get(`hqTaskSourceRequest:${id}`);
        if (
          latest?.content.kind === "value" &&
          (latest.content.value as { readonly requestId: string }).requestId === requestId
        )
          commitOwn(store, "hqTaskSourceRequest", scope, id, {
            requestId,
            after: reads.started(spec),
          });
        reads.readAfterWrite(spec);
        // HQ renames or drops applications' Slack channels as Slack connects again — to another
        // workspace, all of them (`mate-hq apps/hq/src/slack.ts`) — and the bot it connects is in
        // channels of its own; Discord keeps its channels.
        if (change.kind === "slack-connect" || change.kind === "slack-disconnect") {
          const ofOrg = (held: string) => (JSON.parse(held) as [string])[0] === key.orgId;
          reads.againEvery("hqAppSlack", ofOrg);
          reads.againEvery("hqSlackChannels", ofOrg);
        }
      }
    }
  };

  /**
   * Asks HQ for the manifest GitHub makes the organization's app from: the answer, for the
   * screen to post to GitHub, or `null` where HQ refused or did not answer — its words are the
   * GitHub setting's action.
   */
  const githubManifest = async (
    key: OrgSettingKey,
    request: HqGithubManifestRequest,
  ): Promise<HqGithubManifestView | null> => {
    const requestId = await write(key, { kind: "github-manifest", ...request });
    const view = manifests.get(requestId) ?? null;
    manifests.delete(requestId);
    return view;
  };

  return {
    githubManifest,
    /** Reads an organization's setting while a screen shows it. */
    demandOrg: (family: OrgSetting, key: OrgSettingKey) => demandFollowed(specOf(family, key), key),
    /** Reads an application's setting while a screen shows it. */
    demandApp: (family: AppSetting, key: AppSettingKey) => demandFollowed(specOf(family, key), key),
    again: (family: TaskSourceSetting, key: OrgSettingKey | AppSettingKey) =>
      reads.again(specOf(family, key as never)),
    write,
    /** While a screen shows an application's webhooks: a secret HQ answered there stays shown. */
    holdWebhooks: (key: AppSettingKey): (() => void) => {
      const id = settingId(key);
      views.set(id, (views.get(id) ?? 0) + 1);
      return () => {
        const count = (views.get(id) ?? 1) - 1;
        views.set(id, count);
        if (count > 0 || closed) return;
        epochs.set(id, (epochs.get(id) ?? 0) + 1);
        forget(key);
      };
    },
    close: () => {
      if (closed) return;
      for (const id of views.keys()) {
        const [orgId, appId] = JSON.parse(id) as [string, string];
        forget({ orgId, appId });
      }
      closed = true;
      for (const entry of following.values()) entry.stop();
      following.clear();
      secrets.clear();
      manifests.clear();
      revealedFor.clear();
      views.clear();
      epochs.clear();
      reads.close();
    },
  };
}

export type TaskSourceSettings = ReturnType<typeof makeTaskSourceSettings>;
