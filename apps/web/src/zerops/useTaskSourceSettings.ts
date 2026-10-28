/**
 * Where automated Mates take tasks from besides GitHub, read and written through the account
 * (`makeTaskSourceSettings`): the organization's Slack app, Discord application and limits per
 * task, and an application's channels, webhooks and schedules. A screen demands what it shows; a
 * webhook's secret lives only while the screen that made it stays open. The organization's GitHub
 * app is read and made the same way (`useGithubApp`).
 */
import {
  appTaskStops,
  makeTaskSourceSettings,
  taskSourceSetting,
  type AccountStore,
  type AppSetting,
  type OrgSetting,
  type TaskSourceSettingRead,
  type TaskSourceSettingValue,
  type TaskSourceWrite,
  type TaskStopAction,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import type { HqGithubManifestRequest, HqGithubManifestView } from "@t3tools/shared/hqGithub";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { randomUUID } from "../lib/utils";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";

const hosts = new WeakMap<
  AccountStore,
  WeakMap<HqApi, ReturnType<typeof makeTaskSourceSettings>>
>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeTaskSourceSettings({ store, api, makeId: randomUUID });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}

const UNREAD = Atom.make<TaskSourceSettingRead<never>>({
  setting: { state: "unread" },
  action: { kind: "idle" },
  revealed: null,
});

function useHost() {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const host = hq === null || store === null ? null : hostFor(store, hq.api);
  return { host, store, orgId };
}

export interface TaskSourceControls<F extends OrgSetting | AppSetting> {
  readonly read: TaskSourceSettingValue<F>;
  /** A write to it; a connection's tokens and secrets go with it to HQ alone. */
  readonly write: (change: TaskSourceWrite, secrets?: Readonly<Record<string, string>>) => void;
  readonly again: () => void;
}

/** One of the organization's settings, read while `shown`. */
export function useOrgTaskSource<F extends OrgSetting>(
  family: F,
  shown = true,
): TaskSourceControls<F> {
  const { host, store, orgId } = useHost();
  const key = useMemo(() => (orgId === null ? null : { orgId }), [orgId]);
  const read = useAtomValue(
    store === null || key === null
      ? UNREAD
      : store.data.project(taskSourceSetting, { family, orgId: key.orgId }),
  ) as TaskSourceSettingValue<F>;
  useEffect(() => {
    if (shown && host !== null && key !== null) return host.demandOrg(family, key);
  }, [family, host, key, shown]);
  return {
    read,
    write: (change, secrets) => {
      if (host !== null && key !== null) void host.write(key, change, secrets);
    },
    again: () => {
      if (host !== null && key !== null) host.again(family, key);
    },
  };
}

/** One of an application's settings, read while its row is drawn; none while `appId` is not known. */
export function useAppTaskSource<F extends AppSetting>(
  family: F,
  appId: string | null,
): TaskSourceControls<F> {
  const { host, store, orgId } = useHost();
  const key = useMemo(
    () => (orgId === null || appId === null ? null : { orgId, appId }),
    [orgId, appId],
  );
  const read = useAtomValue(
    store === null || key === null
      ? UNREAD
      : store.data.project(taskSourceSetting, { family, orgId: key.orgId, appId: key.appId }),
  ) as TaskSourceSettingValue<F>;
  useEffect(() => {
    if (host === null || key === null) return;
    const release = host.demandApp(family, key);
    // A webhook made here shows its secret while this row stays drawn.
    const hold = family === "hqAppWebhooks" ? host.holdWebhooks(key) : () => {};
    return () => {
      hold();
      release();
    };
  }, [family, host, key]);
  return {
    read,
    write: (change) => {
      if (host !== null && key !== null) void host.write(key, change);
    },
    again: () => {
      if (host !== null && key !== null) host.again(family, key);
    },
  };
}

const NO_STOPS = Atom.make<Readonly<Record<string, TaskStopAction>>>({});

export interface TaskStops {
  /** Where this account's stop of each task stands, by the task; a task with none is absent. */
  readonly stops: Readonly<Record<string, TaskStopAction>>;
  /** Asks HQ to stop the task; its answer is `stops[taskId]`. */
  readonly stop: (taskId: string) => void;
}

/**
 * The stops of an application's tasks a surface shows, one record per task (`appTaskStops`): the
 * session band and the board read the same one, and a second stop never hides the first.
 */
export function useAppTaskStops(appId: string | null, taskIds: ReadonlyArray<string>): TaskStops {
  const { host, store, orgId } = useHost();
  const ids = taskIds.join("\n");
  const key = useMemo(
    () =>
      orgId === null || appId === null
        ? null
        : { orgId, appId, taskIds: ids === "" ? [] : ids.split("\n") },
    [orgId, appId, ids],
  );
  const stops = useAtomValue(
    store === null || key === null ? NO_STOPS : store.data.project(appTaskStops, key),
  );
  return {
    stops,
    stop: (taskId) => {
      if (host !== null && key !== null)
        void host.write({ orgId: key.orgId, appId: key.appId }, { kind: "task-stop", taskId });
    },
  };
}

export interface GithubAppControls extends TaskSourceControls<"hqGithub"> {
  /**
   * Asks HQ for the manifest GitHub makes the organization's app from: the answer to post to
   * GitHub, or `null` where HQ refused or did not answer — its words are `read.action`'s.
   */
  readonly manifest: (request: HqGithubManifestRequest) => Promise<HqGithubManifestView | null>;
  /**
   * Asks HQ for GitHub's page installing the app further, with a one-time state: its address to
   * open, or `null` where HQ refused or did not answer — its words are `read.action`'s.
   */
  readonly install: (returnTo: string) => Promise<string | null>;
}

/** The organization's GitHub app, read while `shown`; made, installed and forgotten from here. */
export function useGithubApp(shown = true): GithubAppControls {
  const controls = useOrgTaskSource("hqGithub", shown);
  const { host, orgId } = useHost();
  return {
    ...controls,
    manifest: async (request) =>
      host === null || orgId === null ? null : host.githubManifest({ orgId }, request),
    install: async (returnTo) =>
      host === null || orgId === null ? null : host.githubInstall({ orgId }, returnTo),
  };
}
