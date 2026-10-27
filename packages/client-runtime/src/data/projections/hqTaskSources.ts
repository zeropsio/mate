/**
 * Where automated Mates take tasks from besides GitHub, as a screen reads each setting: its value
 * as HQ last answered it (never a token or a secret), where this account's last write to it
 * stands — done only once a read started after HQ's answer lands, so a screen never shows the
 * setting as it was after saying it changed — and, for an application's webhooks, the one made
 * from this screen with its secret, while the screen stays open.
 */
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import {
  settingId,
  settingLink,
  settingRequestId,
  settingScope,
  taskStopRequestId,
  type TaskSourceSetting,
} from "../families/hqTaskSources.ts";
import { SETTING_UNSUPPORTED } from "../families/hqAutomation.ts";
import type { FamilyValues } from "../model.ts";
import type { TaskSourceWrite } from "../operations/hqTaskSources.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { actionOf, type AutomationAction } from "./hqAutomation.ts";
import { sameValue } from "./equal.ts";

export interface TaskSourceSettingKey {
  readonly family: TaskSourceSetting;
  readonly orgId: string;
  /** For an application's setting. */
  readonly appId?: string;
}

/** A setting as HQ last answered it. */
export type SettingValue<T> =
  /** `unsupported`: this HQ predates the setting. */
  | { readonly state: "unread" | "reading" | "withheld" | "unsupported" }
  /** `stale`: its last read failed, and this is what HQ said before. */
  | { readonly state: "known"; readonly held: T; readonly stale: boolean }
  | { readonly state: "failed"; readonly words: string };

export interface TaskSourceSettingRead<T> {
  readonly setting: SettingValue<T>;
  readonly action: AutomationAction<TaskSourceWrite["kind"]>;
  /** The webhook made from this screen, with its secret, while it stays open; else `null`. */
  readonly revealed: HqWebhookView | null;
}

export type TaskSourceSettingValue<F extends TaskSourceSetting> = TaskSourceSettingRead<
  FamilyValues[F]
>;

type Reads = ProjectionReads;

/**
 * Where a write recorded under `requestId` stands: done only once a read of its setting started
 * after HQ's answer lands (or that read fails), so a screen never shows the setting as it was
 * after saying it changed. Idle where no write was made from here.
 */
function writeAction(
  read: Reads,
  requestId: string,
  fact: ReturnType<Reads["fact"]>,
  stream: ReturnType<Reads["stream"]>,
): AutomationAction<TaskSourceWrite["kind"]> {
  const request = read.fact("hqTaskSourceRequest", requestId);
  if (request.kind !== "known") return { kind: "idle" };
  const record = read.operation(request.value.requestId);
  const verb = record?.intent.kind === "task-source" ? record.intent.write.kind : null;
  if (verb === null) return { kind: "idle" };
  const action = actionOf(
    record,
    () => verb,
    "HQ may have taken this change. What it holds shows here once it is read again.",
  );
  const shown =
    request.value.after !== null &&
    (stream.fault !== null ||
      (fact.kind === "known" &&
        fact.revision.kind === "mate-link" &&
        fact.revision.sequence > request.value.after));
  return action.kind === "done" && !shown ? { kind: "working", verb: action.verb } : action;
}

const keyOfSetting = (key: TaskSourceSettingKey) =>
  key.appId === undefined ? { orgId: key.orgId } : { orgId: key.orgId, appId: key.appId };

export const taskSourceSetting: Projection<
  TaskSourceSettingKey,
  TaskSourceSettingRead<FamilyValues[TaskSourceSetting]>
> = {
  name: "taskSourceSetting",
  keyOf: (key) => JSON.stringify([key.family, settingId(keyOfSetting(key))]),
  derive: (read, key) => {
    const owner = keyOfSetting(key);
    const id = settingId(owner);
    const fact = read.fact(key.family, id);
    const stream = read.stream(settingScope(key.family, owner));
    const setting: SettingValue<FamilyValues[TaskSourceSetting]> =
      fact.kind === "known"
        ? { state: "known", held: fact.value, stale: stream.fault !== null }
        : fact.kind === "withheld"
          ? { state: "withheld" }
          : read.stream(settingLink(key.family, owner)).fault?.code === SETTING_UNSUPPORTED
            ? { state: "unsupported" }
            : stream.fault !== null
              ? { state: "failed", words: stream.fault.message }
              : {
                  state:
                    stream.phase === "baselining" || stream.phase === "connecting"
                      ? "reading"
                      : "unread",
                };
    const reveal = key.family === "hqAppWebhooks" ? read.fact("hqWebhookReveal", id) : null;
    const revealed = reveal?.kind === "known" ? reveal.value.view : null;
    // This account's own record of its last write here: one never published is none made here.
    const action = writeAction(read, settingRequestId(key.family, owner), fact, stream);
    return { setting, action, revealed };
  },
  equals: sameValue,
};

export interface AppTaskStopsKey {
  readonly orgId: string;
  readonly appId: string;
  /** The tasks a surface shows. */
  readonly taskIds: ReadonlyArray<string>;
}

/** Where a person's stop of a task stands, by the task. */
export type TaskStopAction = AutomationAction<TaskSourceWrite["kind"]>;

/**
 * Where this account's stop of each of an application's tasks stands, by the task, one record
 * each (`taskStopRequestId`): the session band and the board read the same one, and a second
 * stop never hides the first one's refusal. Done once a read of the board started after HQ's
 * answer lands.
 */
export const appTaskStops: Projection<AppTaskStopsKey, Readonly<Record<string, TaskStopAction>>> = {
  name: "appTaskStops",
  keyOf: (key) => JSON.stringify([key.orgId, key.appId, key.taskIds]),
  derive: (read, key) => {
    const owner = { orgId: key.orgId, appId: key.appId };
    const fact = read.fact("hqAppTasks", settingId(owner));
    const stream = read.stream(settingScope("hqAppTasks", owner));
    const stops: Record<string, TaskStopAction> = {};
    for (const taskId of key.taskIds) {
      const action = writeAction(read, taskStopRequestId(owner, taskId), fact, stream);
      if (action.kind !== "idle") stops[taskId] = action;
    }
    return stops;
  },
  equals: sameValue,
};
