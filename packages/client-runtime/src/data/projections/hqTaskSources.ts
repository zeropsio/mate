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
  type TaskSourceSetting,
} from "../families/hqTaskSources.ts";
import { SETTING_UNSUPPORTED } from "../families/hqAutomation.ts";
import type { FamilyValues } from "../model.ts";
import type { TaskSourceWrite } from "../operations/hqTaskSources.ts";
import type { Projection } from "../store.ts";
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
  | { readonly state: "known"; readonly value: T; readonly stale: boolean }
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
        ? { state: "known", value: fact.value, stale: stream.fault !== null }
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
    const request = read.fact("hqTaskSourceRequest", settingRequestId(key.family, owner));
    if (request.kind !== "known") return { setting, action: { kind: "idle" }, revealed };
    const record = read.operation(request.value.requestId);
    const verb = record?.intent.kind === "task-source" ? record.intent.write.kind : null;
    if (verb === null) return { setting, action: { kind: "idle" }, revealed };
    const action = actionOf(
      record,
      () => verb,
      "HQ may have taken this change. What it holds shows here once it is read again.",
    );
    // HQ answered: it shows once a read started after the answer lands, or the read fails.
    const shown =
      request.value.after !== null &&
      (stream.fault !== null ||
        (fact.kind === "known" &&
          fact.revision.kind === "mate-link" &&
          fact.revision.sequence > request.value.after));
    return {
      setting,
      action: action.kind === "done" && !shown ? { kind: "working", verb: action.verb } : action,
      revealed,
    };
  },
  equals: sameValue,
};
