/**
 * Where automated Mates take tasks from besides GitHub, read and written through the account
 * (`makeTaskSourceSettings`): the organization's Slack app, Discord application and limits per
 * task, and an application's channels, webhooks and schedules. A screen demands what it shows; a
 * webhook's secret lives only while the screen that made it stays open. The organization's GitHub
 * apps are read and made the same way (`useGithubApp`).
 */
import {
  appTaskPut,
  appTaskWrites,
  makeTaskSourceSettings,
  taskSourceSetting,
  type AccountStore,
  type AppSetting,
  type OrgSetting,
  type TaskSourceSettingRead,
  type TaskSourceSettingValue,
  type TaskSourceWrite,
  type TaskWriteAction,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import type {
  HqGithubApp,
  HqGithubManifestRequest,
  HqGithubManifestView,
} from "@t3tools/shared/hqGithub";
import type { HqAppTask, HqPutTaskRequest } from "@t3tools/shared/hqIntake";
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

const NO_STOPS = Atom.make<Readonly<Record<string, TaskWriteAction>>>({});

export interface TaskStops {
  /** Where this account's stop of each task stands, by the task; a task with none is absent. */
  readonly stops: Readonly<Record<string, TaskWriteAction>>;
  /** Asks HQ to stop the task; its answer is `stops[taskId]`. */
  readonly stop: (taskId: string) => void;
}

/**
 * The stops of an application's tasks a surface shows, one record per task (`appTaskWrites`): the
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
    store === null || key === null ? NO_STOPS : store.data.project(appTaskWrites, key),
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
  /** Every app HQ holds for the organization, oldest first; `null` while HQ has not answered. */
  readonly apps: ReadonlyArray<HqGithubApp> | null;
  /**
   * Asks HQ for the manifest GitHub makes another of the organization's apps from: the answer to
   * post to GitHub, or `null` where HQ refused or did not answer — its words are `read.action`'s.
   * It adds an app and never replaces one.
   */
  readonly manifest: (request: HqGithubManifestRequest) => Promise<HqGithubManifestView | null>;
  /**
   * Asks HQ for GitHub's page installing app `githubAppId` further, with a one-time state: its
   * address to open, or `null` where HQ refused or did not answer — its words are `read.action`'s.
   */
  readonly install: (githubAppId: number, returnTo: string) => Promise<string | null>;
  /** HQ forgets the app and its installations; it stays on GitHub. */
  readonly forget: (githubAppId: number) => void;
}

/** The organization's GitHub apps, read while `shown`; made, installed and forgotten from here. */
export function useGithubApp(shown = true): GithubAppControls {
  const controls = useOrgTaskSource("hqGithub", shown);
  const { host, orgId } = useHost();
  const setting = controls.read.setting;
  return {
    ...controls,
    apps: setting.state === "known" ? setting.held.apps : null,
    manifest: async (request) =>
      host === null || orgId === null ? null : host.githubManifest({ orgId }, request),
    install: async (githubAppId, returnTo) =>
      host === null || orgId === null ? null : host.githubInstall({ orgId }, githubAppId, returnTo),
    forget: (githubAppId) => {
      controls.write({ kind: "github-forget", githubAppId });
    },
  };
}

const IDLE_PUT = Atom.make<TaskWriteAction>({ kind: "idle" });

/** The Board's writes to an application's tasks, each answered by the task as it stands, or `null`. */
export interface BoardTaskWrites {
  /** Puts work on the Board from a conversation, pressed on `card`. */
  readonly put: (card: string, request: HqPutTaskRequest) => Promise<HqAppTask | null>;
  /** Takes a queued task for one of the person's own Mates. */
  readonly take: (taskId: string, mateProjectId: string) => Promise<HqAppTask | null>;
  readonly release: (taskId: string) => Promise<HqAppTask | null>;
  readonly done: (taskId: string) => Promise<HqAppTask | null>;
  /** Its putter's answer or steer on a conversation's task a pool Mate holds. */
  readonly answer: (taskId: string, text: string) => void;
}

/**
 * The Board's writes to application `appId`'s tasks; where each stands is `useAppTaskStops`'s
 * record by the task, and a put's `useAppTaskPut`'s by its card. `null` while no HQ or application
 * is known.
 */
export function useBoardTaskWrites(appId: string | null): BoardTaskWrites | null {
  const { host, orgId } = useHost();
  return useMemo(() => {
    if (host === null || orgId === null || appId === null) return null;
    const key = { orgId, appId };
    return {
      put: (card, request) => host.putTask(key, card, request),
      take: (taskId, mateProjectId) => host.takeTask(key, taskId, mateProjectId),
      release: (taskId) => host.releaseTask(key, taskId),
      done: (taskId) => host.doneTask(key, taskId),
      answer: (taskId, text) => void host.write(key, { kind: "task-message", taskId, text }),
    };
  }, [appId, host, orgId]);
}

/** Where the Put on board pressed on `card` stands (`appTaskPut`): idle where none was pressed. */
export function useAppTaskPut(appId: string | null, card: string): TaskWriteAction {
  const { store, orgId } = useHost();
  const key = useMemo(
    () => (orgId === null || appId === null ? null : { orgId, appId, card }),
    [orgId, appId, card],
  );
  return useAtomValue(
    store === null || key === null ? IDLE_PUT : store.data.project(appTaskPut, key),
  );
}
